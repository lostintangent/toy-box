// Durable workspace inbox entries. An entry's ID is its managed session ID, and
// its optional artifact is an ordinary file in that session's workspace, recorded
// here only by filename.

import { getStateDatabase } from "../database";
import type { InboxEntry } from "@/types";

export async function getInboxEntries(): Promise<InboxEntry[]> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return [];
  const rows = await db<InboxEntryRow[]>`SELECT * FROM inbox ORDER BY created_at DESC`;
  return rows.map(inboxEntryFromRow);
}

export async function getInboxEntry(entryId: string): Promise<InboxEntry | null> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return null;
  const [row] = await db<InboxEntryRow[]>`SELECT * FROM inbox WHERE id = ${entryId}`;
  return row ? inboxEntryFromRow(row) : null;
}

export async function hasInboxEntry(entryId: string): Promise<boolean> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return false;
  const rows = await db<{ present: number }[]>`
    SELECT 1 AS present FROM inbox WHERE id = ${entryId}
  `;
  return rows.length > 0;
}

export async function createInboxEntry(id: string): Promise<InboxEntry> {
  const entry: InboxEntry = {
    id: validateEntryId(id),
    createdAt: new Date().toISOString(),
  };
  const db = await getStateDatabase();
  await db`
    INSERT INTO inbox (id, message, artifact, created_at)
    VALUES (${entry.id}, ${null}, ${null}, ${entry.createdAt})
  `;
  return entry;
}

export async function completeInboxEntry(
  id: string,
  message: string,
  artifactFilename?: string,
): Promise<InboxEntry> {
  const entryId = validateEntryId(id);
  const existing = await getInboxEntry(entryId);
  if (!existing) throw new Error("Inbox entry not found.");
  if (existing.message !== undefined) throw new Error("Inbox entry already completed.");

  const filename = artifactFilename ? validateFilename(artifactFilename) : undefined;

  const db = await getStateDatabase();
  const [row] = await db<InboxEntryRow[]>`
    UPDATE inbox
    SET message = ${message}, artifact = ${filename ?? null}
    WHERE id = ${entryId} AND message IS NULL
    RETURNING *
  `;
  if (!row) throw new Error("Inbox entry already completed.");

  return inboxEntryFromRow(row);
}

export async function deleteInboxEntryState(entryId: string): Promise<boolean> {
  entryId = validateEntryId(entryId);
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return false;
  const rows = await db<{ id: string }[]>`
    DELETE FROM inbox WHERE id = ${entryId} RETURNING id
  `;
  return rows.length > 0;
}

type InboxEntryRow = {
  id: string;
  message: string | null;
  artifact: string | null;
  created_at: string;
};

function inboxEntryFromRow(row: InboxEntryRow): InboxEntry {
  return {
    id: row.id,
    createdAt: row.created_at,
    ...(row.message !== null ? { message: row.message } : {}),
    ...(row.artifact !== null ? { artifact: row.artifact } : {}),
  };
}

function validateEntryId(entryId: string): string {
  const value = entryId.trim();
  if (!isSafePathSegment(value)) throw new Error("Invalid inbox entry ID.");
  return value;
}

function validateFilename(filename: string): string {
  const value = filename.trim();
  if (!isSafeFilename(value)) throw new Error("Artifact filename must be one safe file name.");
  return value;
}

function isSafeFilename(value: string): boolean {
  return isSafePathSegment(value);
}

function isSafePathSegment(value: string): boolean {
  return Boolean(
    value &&
    value !== "." &&
    value !== ".." &&
    value.length <= 255 &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("\0"),
  );
}
