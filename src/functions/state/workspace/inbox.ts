// Durable workspace inbox entries and their optional editable files.
//
// An entry's ID is its managed session ID. Its row owns an optional file at
// `~/.toy-box/inbox/<id>/<filename>`; deleting the entry releases both.

import { rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getAppDatabase } from "../database";
import type { InboxEntry } from "@/types";

export async function getInboxEntries(): Promise<InboxEntry[]> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return [];
  const { rows } = await db.sql`SELECT * FROM inbox ORDER BY created_at DESC`;
  return (rows as InboxEntryRow[]).map(inboxEntryFromRow);
}

export async function getInboxEntry(entryId: string): Promise<InboxEntry | null> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return null;
  const { rows } = await db.sql`SELECT * FROM inbox WHERE id = ${entryId}`;
  const row = (rows as InboxEntryRow[])[0];
  return row ? inboxEntryFromRow(row) : null;
}

export async function hasInboxEntry(entryId: string): Promise<boolean> {
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return false;
  const { rows } = await db.sql`SELECT 1 FROM inbox WHERE id = ${entryId}`;
  return (rows?.length ?? 0) > 0;
}

export async function createInboxEntry(id: string): Promise<InboxEntry> {
  const entry: InboxEntry = {
    id: validateEntryId(id),
    createdAt: new Date().toISOString(),
  };
  const db = await getAppDatabase();
  await db.sql`
    INSERT INTO inbox (id, message, artifact, created_at)
    VALUES (${entry.id}, ${null}, ${null}, ${entry.createdAt})
  `;
  return entry;
}

export async function completeInboxEntry(
  id: string,
  message: string,
  artifact?: { filename: string; content: string },
): Promise<InboxEntry> {
  const entryId = validateEntryId(id);
  const existing = await getInboxEntry(entryId);
  if (!existing) throw new Error("Inbox entry not found.");
  if (existing.message !== undefined) throw new Error("Inbox entry already completed.");

  const artifactFilename = artifact ? validateFilename(artifact.filename) : undefined;
  const directory = join(inboxRoot(), entryId);

  if (artifact && artifactFilename) {
    await mkdir(inboxRoot(), { recursive: true });
    await mkdir(directory);
    try {
      await writeFile(join(directory, artifactFilename), artifact.content, {
        encoding: "utf-8",
        flag: "wx",
      });
    } catch (error) {
      rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  try {
    const db = await getAppDatabase();
    const result = await db.sql`
      UPDATE inbox
      SET message = ${message}, artifact = ${artifactFilename ?? null}
      WHERE id = ${entryId} AND message IS NULL
    `;
    if ((result.changes ?? 0) === 0) throw new Error("Inbox entry already completed.");
  } catch (error) {
    if (artifactFilename) rmSync(directory, { recursive: true, force: true });
    throw error;
  }

  return {
    ...existing,
    message,
    ...(artifactFilename ? { artifact: artifactFilename } : {}),
  };
}

export async function deleteInboxEntryState(entryId: string): Promise<boolean> {
  entryId = validateEntryId(entryId);
  const db = await getAppDatabase({ createIfMissing: false });
  if (!db) return false;
  const result = await db.sql`DELETE FROM inbox WHERE id = ${entryId}`;
  if ((result.changes ?? 0) === 0) return false;
  deleteInboxArtifact(entryId);
  return true;
}

export function deleteInboxArtifact(entryId: string): void {
  entryId = validateEntryId(entryId);
  rmSync(join(inboxRoot(), entryId), { recursive: true, force: true });
}

export function resolveInboxArtifactPath(entryId: string, filename: string): string | null {
  entryId = entryId.trim();
  filename = filename.trim();
  return isSafePathSegment(entryId) && isSafeFilename(filename)
    ? join(inboxRoot(), entryId, filename)
    : null;
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

function inboxRoot(): string {
  return join(homedir(), ".toy-box", "inbox");
}
