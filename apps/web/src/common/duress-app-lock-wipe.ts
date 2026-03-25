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

import { db } from "./db";
import { store as appStore } from "../stores/app-store";
import { store as noteStore } from "../stores/note-store";
import { store as notebookStore } from "../stores/notebook-store";
import { store as trashStore } from "../stores/trash-store";
import { useEditorStore } from "../stores/editor-store";

const NOTE_CHUNK = 100;
const DURESS_WIPE_PENDING_KEY = "appLock:duressWipePending";

export function markDuressWipePending() {
  try {
    window.localStorage.setItem(DURESS_WIPE_PENDING_KEY, "1");
  } catch {
    // ignore
  }
}

export function consumeDuressWipePending(): boolean {
  try {
    const pending = window.localStorage.getItem(DURESS_WIPE_PENDING_KEY) === "1";
    if (pending) window.localStorage.removeItem(DURESS_WIPE_PENDING_KEY);
    return pending;
  } catch {
    return false;
  }
}

/**
 * Permanently removes every note (active and trashed). Invoked after a successful duress PIN unlock.
 */
export async function wipeAllNotesAfterDuressAppLockUnlock() {
  const rows = await db
    .sql()
    .selectFrom("notes")
    .select(["id", "type"])
    .where("type", "in", ["note", "trash"])
    .execute();

  const activeIds = rows
    .filter((r) => r.type === "note")
    .map((r) => r.id as string);

  for (let i = 0; i < activeIds.length; i += NOTE_CHUNK) {
    await db.notes.moveToTrash(...activeIds.slice(i, i + NOTE_CHUNK));
  }

  const allIds = rows.map((r) => r.id as string);
  for (let i = 0; i < allIds.length; i += NOTE_CHUNK) {
    await db.trash.delete(...allIds.slice(i, i + NOTE_CHUNK));
  }

  await noteStore.refresh();
  await trashStore.refresh();
  await notebookStore.refresh();
  await appStore.refreshNavItems();

  // The wipe runs before app effects initialize stores/subscriptions.
  // Ensure any persisted editor tabs/sessions are cleared so UI doesn't keep showing deleted notes.
  useEditorStore.getState().closeAllTabs();
  useEditorStore.setState({ documentPreview: undefined });
}
