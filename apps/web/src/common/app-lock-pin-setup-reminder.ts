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

import dayjs from "dayjs";
import Config from "../utils/config";
import { showToast } from "../utils/toast";
import { TaskScheduler } from "../utils/task-scheduler";
import { SettingsDialog } from "../dialogs/settings";
import { useStore as useUserStore } from "../stores/user-store";
import { APP_LOCK_DURESS_CREDENTIAL_ID, useKeyStore } from "../interfaces/key-store";
import { userEligibleForDuressAppLock } from "../utils/app-lock-duress-eligibility";

const TASK_ID = "app-lock:pin-setup-reminder";
const NEXT_AT_KEY = "appLockPinSetupReminderNextAt";
const IGNORED_KEY = "ignored:appLockPinSetup";

const ENABLED_KEY = "appLockPinSetupReminderEnabled";
const MIN_DAYS_KEY = "appLockPinSetupReminderMinDays";
const MAX_DAYS_KEY = "appLockPinSetupReminderMaxDays";

function isReminderEnabled() {
  return Config.get(ENABLED_KEY, true);
}

function getReminderWindowDays(): { minDays: number; maxDays: number } {
  const minDaysRaw = Config.get(MIN_DAYS_KEY, 1);
  const maxDaysRaw = Config.get(MAX_DAYS_KEY, 2);
  const minDays = Number.isFinite(minDaysRaw) ? Number(minDaysRaw) : 1;
  const maxDays = Number.isFinite(maxDaysRaw) ? Number(maxDaysRaw) : 2;
  return {
    minDays: Math.max(0, Math.min(minDays, maxDays)),
    maxDays: Math.max(0, Math.max(minDays, maxDays))
  };
}

function randomDelayMs(minDays: number, maxDays: number) {
  const minMs = minDays * 24 * 60 * 60 * 1000;
  const maxMs = maxDays * 24 * 60 * 60 * 1000;
  if (maxMs <= minMs) return minMs;
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1));
}

function shouldRemindNow(): boolean {
  if (!isReminderEnabled()) return false;
  if (Config.get(IGNORED_KEY, false)) return false;

  const user = useUserStore.getState().user;
  if (!userEligibleForDuressAppLock(user)) return false;

  const ks = useKeyStore.getState();
  const primary = ks.findCredential({ type: "password", id: "password" });
  const duress = ks.findCredential({
    type: "password",
    id: APP_LOCK_DURESS_CREDENTIAL_ID
  });

  // Requirement: only remind when both PIN and duress PIN are not set.
  return !primary && !duress;
}

function toOneTimeCron(dateMs: number) {
  return dayjs(dateMs).format("00 mm HH DD MM * YYYY");
}

async function clearSchedule() {
  Config.remove(NEXT_AT_KEY);
  await TaskScheduler.stop(TASK_ID);
}

async function scheduleAt(nextAt: number) {
  Config.set(NEXT_AT_KEY, nextAt);
  await TaskScheduler.stop(TASK_ID);
  await TaskScheduler.register(TASK_ID, toOneTimeCron(nextAt), () => {
    void runReminderToast();
  });
}

async function runReminderToast() {
  // If user fixed it meanwhile, stop/clear.
  if (!shouldRemindNow()) {
    await clearSchedule();
    return;
  }

  const { minDays, maxDays } = getReminderWindowDays();
  const reschedule = async () => {
    const next = Date.now() + randomDelayMs(minDays, maxDays);
    await scheduleAt(next);
  };

  const toast = showToast(
    "info",
    "Set up a PIN and Duress PIN to enable App Lock.",
    [
      {
        text: "Set up",
        type: "accent",
        onClick: async () => {
          toast.hide();
          await SettingsDialog.show({ activeSection: "app-lock" });
          await reschedule();
        }
      },
      {
        text: "Later",
        type: "paragraph",
        onClick: async () => {
          toast.hide();
          await reschedule();
        }
      },
      // {
      //   text: "Don’t remind",
      //   type: "paragraph",
      //   onClick: async () => {
      //     toast.hide();
      //     Config.set(IGNORED_KEY, true);
      //     await clearSchedule();
      //   }
      // }
    ],
    0
  );
}

export async function initAppLockPinSetupReminder() {
  const evaluateAndSchedule = async () => {
    if (!shouldRemindNow()) {
      await clearSchedule();
      return;
    }

    const existing = Config.get<number>(NEXT_AT_KEY, 0);
    const now = Date.now();
    if (existing && existing > now) {
      await scheduleAt(existing);
      return;
    }
    if (existing && existing <= now) {
      await runReminderToast();
      return;
    }

    const { minDays, maxDays } = getReminderWindowDays();
    const nextAt = now + randomDelayMs(minDays, maxDays);
    await scheduleAt(nextAt);
  };

  await evaluateAndSchedule();

  const unsubUser = useUserStore.subscribe((s) => s.user, () => {
    evaluateAndSchedule();
  });
  const unsubCreds = useKeyStore.subscribe((s) => s.credentials, () => {
    evaluateAndSchedule();
  });

  return () => {
    unsubUser();
    unsubCreds();
  };
}

