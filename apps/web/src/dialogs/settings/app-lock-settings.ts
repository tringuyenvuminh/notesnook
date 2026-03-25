/*
This file is part of the Notesnook project (https://notesnook.com/)

Copyright (C) 2023 Streetwriters (Private) Limited

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License
along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

import { strings } from "@notesnook/intl";
import { checkFeature, verifyAccount } from "../../common";
import { Checkmark } from "../../components/icons";
import { showPasswordDialog } from "../../dialogs/password-dialog";
import {
  APP_LOCK_DURESS_CREDENTIAL_ID,
  CredentialType,
  CredentialWithSecret,
  CredentialWithoutSecret,
  DEFAULT_ITERATIONS,
  useKeyStore,
  wrongCredentialError
} from "../../interfaces/key-store";
import { userEligibleForDuressAppLock } from "../../utils/app-lock-duress-eligibility";
import { useStore as useUserStore } from "../../stores/user-store";
import { generatePassword } from "../../utils/password-generator";
import { showToast } from "../../utils/toast";
import { WebAuthn } from "../../utils/webauthn";
import { PromptDialog } from "../prompt";
import { SettingComponent, SettingsGroup } from "./types";

export const AppLockSettings: SettingsGroup[] = [
  {
    key: "app-lock",
    section: "app-lock",
    header: "App lock",
    onStateChange: (listener) =>
      useKeyStore.subscribe((s) => s.credentials, listener),
    settings: [
      {
        key: "enable-app-lock",
        title: "Enable app lock",
        onStateChange: (listener) =>
          useKeyStore.subscribe((s) => s.credentials, listener),
        featureId: "appLock",
        components: [
          {
            type: "toggle",
            toggle: async () => {
              const { credentials } = useKeyStore.getState();
              const defaultCredential = credentials
                .filter((c) => c.active)
                .at(0);

              if (!defaultCredential) {
                const verified = await verifyAccount();
                if (!verified) return;

                await registerCredential("password");
              } else {
                await unlockAppLock(defaultCredential);
              }
            },
            isToggled: () =>
              useKeyStore.getState().credentials.some((c) => c.active)
          }
        ]
      },
      {
        key: "lock-app-after",
        title: "Lock app after",
        description:
          "How long should the app wait to lock itself after going into the background or going idle?",
        isHidden: () => useKeyStore.getState().activeCredentials().length <= 0,
        onStateChange: (listener) =>
          useKeyStore.subscribe((s) => s.secrets.lockAfter, listener),
        components: [
          {
            type: "dropdown",
            options: [
              { title: "Immediately", value: 0 },
              { title: "1 minute", value: 1 },
              { title: "5 minutes", value: 5 },
              { title: "10 minutes", value: 10 },
              { title: "15 minutes", value: 15 },
              { title: "30 minutes", value: 30 },
              { title: "45 minutes", value: 45 },
              { title: "1 hour", value: 60 },
              { title: "Never", value: -1 }
            ],
            onSelectionChanged: async (value) => {
              if (!(await authenticateAppLock())) {
                showToast("error", "Failed to authenticate.");
                return;
              }
              useKeyStore.getState().setValue("lockAfter", parseInt(value));
            },
            selectedOption: async () => {
              return (await useKeyStore.getState().getValue("lockAfter")) || 0;
            }
          }
        ]
      }
    ]
  },
  {
    key: "app-lock-credentials",
    section: "app-lock",
    header: strings.credientials(),
    isHidden: () => {
      return useKeyStore.getState().activeCredentials().length <= 0;
    },
    onStateChange: (listener) =>
      useKeyStore.subscribe((s) => s.credentials, listener),
    settings: [
      {
        key: "password-pin",
        title: strings.passwordPin(),
        description: strings.passwordPinDescription(),
        components: () => {
          const credential = useKeyStore
            .getState()
            .findCredential({ type: "password", id: "password" });
          const isEnabled = credential?.active;

          const inputs: SettingComponent[] = [];
          const duressCred = useKeyStore
            .getState()
            .findCredential({
              type: "password",
              id: APP_LOCK_DURESS_CREDENTIAL_ID
            });
          if (isEnabled) {
            inputs.push({
              type: "button",
              title: strings.change(),
              action: async () => {
                const result = await showPasswordDialog({
                  title: strings.changeAppLockPassword(),
                  inputs: {
                    oldPassword: {
                      label: strings.oldPassword(),
                      autoComplete: "current-password"
                    },
                    newPassword: {
                      label: strings.newPassword(),
                      autoComplete: "new-password"
                    },
                    confirmPassword: {
                      label: strings.confirmPassword(),
                      autoComplete: "new-password"
                    }
                  },
                  validate({ newPassword, oldPassword, confirmPassword }) {
                    if (newPassword !== confirmPassword)
                      return Promise.resolve(false);
                    return useKeyStore
                      .getState()
                      .changeCredential(
                        {
                          type: "password",
                          id: "password",
                          password: oldPassword
                        },
                        {
                          type: "password",
                          id: "password",
                          password: newPassword
                        }
                      )
                      .then(() => true)
                      .catch(() => false);
                  }
                });
                if (result)
                  showToast("success", strings.passwordChangedSuccessfully());
              },
              variant: "secondary"
            });

            if (duressCred) {
              inputs.push({
                type: "button",
                title: strings.changeDuressAppLockPin(),
                action: async () => {
                  const result = await showPasswordDialog({
                    title: strings.changeDuressAppLockPin(),
                    inputs: {
                      oldPassword: {
                        label: strings.oldPassword(),
                        autoComplete: "current-password"
                      },
                      newPassword: {
                        label: strings.newPassword(),
                        autoComplete: "new-password"
                      },
                      confirmPassword: {
                        label: strings.confirmPassword(),
                        autoComplete: "new-password"
                      }
                    },
                    validate({ newPassword, oldPassword, confirmPassword }) {
                      if (newPassword !== confirmPassword)
                        return Promise.resolve(false);
                      return useKeyStore
                        .getState()
                        .changeCredential(
                          {
                            type: "password",
                            id: APP_LOCK_DURESS_CREDENTIAL_ID,
                            password: oldPassword
                          },
                          {
                            type: "password",
                            id: APP_LOCK_DURESS_CREDENTIAL_ID,
                            password: newPassword
                          }
                        )
                        .then(() => true)
                        .catch(() => false);
                    }
                  });
                  if (result)
                    showToast("success", strings.passwordChangedSuccessfully());
                },
                variant: "secondary"
              });
            } else if (userEligibleForDuressAppLock()) {
              inputs.push({
                type: "button",
                title: strings.setupDuressAppLockPin(),
                action: () => addDuressAppLockCredential(),
                variant: "secondary"
              });
            }
          }

          if (
            !isEnabled ||
            useKeyStore.getState().activeCredentials().length > 1
          )
            inputs.push({
              type: "button",
              title: isEnabled ? strings.disable() : strings.enable(),
              action: async () => {
                if (credential?.active) await deactivateCredential(credential);
                else if (credential)
                  await useKeyStore.getState().activate(credential);
                else {
                  if (!(await authenticateAppLock())) {
                    showToast("error", strings.biometricsAuthError());
                    return;
                  }
                  await registerCredential("password");
                }
              },
              variant: "secondary"
            });

          return inputs;
        }
      },
      {
        key: "security-key",
        title: strings.securityKey(),
        description: strings.securityKeyDescription(),
        onStateChange: (listener) =>
          useKeyStore.subscribe((s) => s.credentials, listener),
        components: () => {
          const { findCredential } = useKeyStore.getState();
          const credential = findCredential({
            type: "securityKey",
            id: "securityKey"
          });
          const isEnabled = credential?.active;
          const hasActiveCredentials =
            useKeyStore.getState().activeCredentials().length > 1;

          const inputs: SettingComponent[] = [];
          if (credential && hasActiveCredentials) {
            inputs.push({
              type: "button",
              title: strings.unregister(),
              action: async () => {
                if (await useKeyStore.getState().credentialHasKey(credential)) {
                  await verifyCredential(credential, (c) =>
                    useKeyStore.getState().unregister(c)
                  );
                } else {
                  useKeyStore.getState().unregister(credential);
                }
              },
              variant: "secondary"
            });
          }

          if (!credential) {
            inputs.push({
              type: "button",
              title: strings.register(),
              variant: "secondary",
              async action() {
                if (!(await authenticateAppLock())) {
                  showToast("error", strings.biometricsAuthError());
                  return;
                }
                await registerCredential("securityKey");
              }
            });
          } else if (!isEnabled || hasActiveCredentials) {
            inputs.push({
              type: "button",
              title: isEnabled ? strings.disable() : strings.enable(),
              action: async () => {
                const hasKey = await useKeyStore.getState().credentialHasKey({
                  type: "securityKey",
                  id: "securityKey"
                });
                if (!hasKey && !credential?.active)
                  await verifyCredential(credential, (c) =>
                    useKeyStore.getState().activate(c)
                  );
                else if (credential?.active)
                  await deactivateCredential(credential);
                else if (credential)
                  await useKeyStore.getState().activate(credential);
              },
              variant: "secondary"
            });
          }

          if (inputs.length === 0)
            inputs.push({
              type: "icon",
              icon: Checkmark,
              color: "accent",
              size: 24
            });

          return inputs;
        }
      }
    ]
  }
];

async function addDuressAppLockCredential() {
  if (!(await authenticateAppLock())) {
    showToast("error", strings.biometricsAuthError());
    return;
  }
  const added = await showPasswordDialog({
    title: strings.setupDuressAppLockPin(),
    subtitle: strings.setupDuressAppLockPinDesc(),
    inputs: {
      currentPassword: {
        label: strings.oldPassword(),
        autoComplete: "current-password"
      },
      duressPassword: {
        label: strings.enterDuressAppLockPin(),
        autoComplete: "new-password"
      },
      confirmDuressPassword: {
        label: strings.confirmDuressAppLockPin(),
        autoComplete: "new-password"
      }
    },
    async validate({
      currentPassword,
      duressPassword,
      confirmDuressPassword
    }) {
      if (duressPassword !== confirmDuressPassword) {
        throw new Error(strings.appLockDuressPinMismatch());
      }
      if (currentPassword === duressPassword) {
        throw new Error(strings.appLockDuressPinMustDiffer());
      }
      const ks = useKeyStore.getState();
      const ok = await ks.verifyCredential({
        type: "password",
        id: "password",
        password: currentPassword
      });
      if (!ok) throw new Error(strings.passwordIncorrect());

      await ks.register({
        type: "password",
        id: APP_LOCK_DURESS_CREDENTIAL_ID,
        salt: window.crypto.getRandomValues(new Uint8Array(16)),
        iterations: DEFAULT_ITERATIONS
      });
      await ks.activate(
        {
          type: "password",
          id: APP_LOCK_DURESS_CREDENTIAL_ID,
          password: duressPassword
        },
        { persistActive: false }
      );
      return true;
    }
  });
  if (added) showToast("success", strings.passwordChangedSuccessfully());
}

async function registerCredential(type: CredentialType) {
  if (type === "password") {
    if (userEligibleForDuressAppLock()) {
      await showPasswordDialog({
        title: strings.setupAppLockPin(),
        subtitle: strings.enterPasswordOrPin(),
        inputs: {
          password: {
            label: strings.enterAppLockPinCode(),
            autoComplete: "new-password"
          },
          confirmPassword: {
            label: strings.confirmAppLockPinCode(),
            autoComplete: "new-password"
          },
          duressPassword: {
            label: strings.enterDuressAppLockPin(),
            autoComplete: "new-password"
          },
          confirmDuressPassword: {
            label: strings.confirmDuressAppLockPin(),
            autoComplete: "new-password"
          }
        },
        afterInput: {
          confirmPassword: strings.appLockPinUnlockHintMd(),
          confirmDuressPassword: strings.appLockDuressPinWipeHintMd()
        },
        async validate({
          password,
          confirmPassword,
          duressPassword,
          confirmDuressPassword
        }) {
          if (confirmPassword !== password) {
            throw new Error(strings.appLockPrimaryPinMismatch());
          }
          if (confirmDuressPassword !== duressPassword) {
            throw new Error(strings.appLockDuressPinMismatch());
          }
          if (password === duressPassword) {
            throw new Error(strings.appLockDuressPinMustDiffer());
          }
          const { register, activate } = useKeyStore.getState();
          await register({
            type,
            id: "password",
            salt: window.crypto.getRandomValues(new Uint8Array(16)),
            iterations: DEFAULT_ITERATIONS
          });
          await activate({
            type,
            id: "password",
            password
          });
          await register({
            type: "password",
            id: APP_LOCK_DURESS_CREDENTIAL_ID,
            salt: window.crypto.getRandomValues(new Uint8Array(16)),
            iterations: DEFAULT_ITERATIONS
          });
          await activate(
            {
              type: "password",
              id: APP_LOCK_DURESS_CREDENTIAL_ID,
              password: duressPassword
            },
            { persistActive: false }
          );
          return true;
        }
      });
    } else {
      await showPasswordDialog({
        title: strings.appLock(),
        subtitle: strings.enterPasswordOrPin(),
        inputs: {
          password: {
            label: strings.password(),
            autoComplete: "new-password"
          },
          confirmPassword: {
            label: strings.confirmPassword(),
            autoComplete: "new-password"
          }
        },
        async validate({ confirmPassword, password }) {
          if (confirmPassword !== password) return false;
          const { register, activate } = useKeyStore.getState();
          await register({
            type,
            id: "password",
            salt: window.crypto.getRandomValues(new Uint8Array(16)),
            iterations: DEFAULT_ITERATIONS
          }).then(() =>
            activate({
              type,
              id: "password",
              password
            })
          );
          return true;
        }
      });
    }
  } else if (type === "securityKey") {
    const user = useUserStore.getState().user;
    const username =
      user?.email ||
      (await PromptDialog.show({
        title: strings.securityKeyUsername(),
        description: strings.securityKeyUsernameDesc()
      }));
    if (!username) return;

    const userId = user
      ? Buffer.from(user.id, "hex")
      : // fixed id for unregistered users to avoid creating duplicate credentials
        new Uint8Array([0x61, 0xd1, 0x20, 0x82]);

    try {
      const { firstSalt, rawId, transports } =
        await WebAuthn.registerSecurityKey(userId, username);

      await useKeyStore.getState().register({
        type,
        id: "securityKey",
        config: {
          firstSalt,
          label: generatePassword(),
          rawId,
          transports
        }
      });

      showToast("success", strings.securityKeyRegistered());
    } catch (e) {
      showToast("error", (e as Error).message);
    }
  }
}

async function unlockAppLock(credential: CredentialWithoutSecret) {
  await verifyCredential(credential, (cred) =>
    useKeyStore.getState().unlock(cred, { permanent: true })
  );
}

async function deactivateCredential(credential: CredentialWithoutSecret) {
  await verifyCredential(credential, (cred) =>
    useKeyStore.getState().deactivate(cred)
  );
}

async function verifyCredential(
  credential: CredentialWithoutSecret,
  action: (credential: CredentialWithSecret) => Promise<unknown>
) {
  try {
    if (credential.type === "password") {
      return await showPasswordDialog({
        title: strings.appLock(),
        subtitle: strings.enterPasswordOrPin(),
        inputs: {
          password: {
            label: strings.password(),
            autoComplete: "new-password"
          }
        },
        async validate({ password }) {
          await action({
            ...credential,
            password
          });
          return true;
        }
      });
    } else if (credential.type === "securityKey") {
      const config = credential.config;
      const { encryptionKey } = await WebAuthn.getEncryptionKey(config as any);

      return await action({
        ...credential,
        key: encryptionKey
      });
    }
  } catch (e) {
    console.error(e);
    if (!(e instanceof Error)) return showToast("error", JSON.stringify(e));
    if (e.message.includes("The operation either timed out or was not allowed"))
      return false;
    showToast("error", e.message);
  }
}

async function authenticateAppLock() {
  const defaultCredential = useKeyStore
    .getState()
    .credentials.filter((c) => c.active)
    .at(0);
  if (!defaultCredential) {
    return verifyAccount();
  }
  return !!(await verifyCredential(defaultCredential, async (c) => {
    if (!(await useKeyStore.getState().verifyCredential(c)))
      throw new Error(wrongCredentialError(c));
  }));
}
