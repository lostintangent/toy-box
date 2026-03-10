// Session attachment temp file storage.
//
// Image attachments uploaded by the user are written to a per-session
// temp directory so the SDK can reference them by path. This module owns
// the full lifecycle: write base64 to disk, read back from disk, and
// cleanup when a session is deleted.

import { extname, join } from "node:path";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { Attachment } from "@/types";

const ATTACHMENTS_DIR = join(tmpdir(), "copilot-attachments");

/** Write attachments to disk and return SDK-compatible file references */
export async function writeAttachments(
  sessionId: string,
  attachments?: Attachment[],
): Promise<Array<{ type: "file"; path: string }> | undefined> {
  if (!attachments || attachments.length === 0) return undefined;
  const withData = attachments.filter((att) => att.base64);
  if (withData.length === 0) return undefined;
  const dir = join(ATTACHMENTS_DIR, sessionId);
  await mkdir(dir, { recursive: true });
  return Promise.all(
    withData.map(async (att) => {
      const ext = att.mimeType.split("/")[1] || "png";
      const imagePath = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`);
      await writeFile(imagePath, Buffer.from(att.base64!, "base64"));
      return { type: "file" as const, path: imagePath };
    }),
  );
}

/** Read an attachment back from its on-disk path into an Attachment object */
export async function readAttachment(raw: {
  displayName?: string;
  path?: string;
  filePath?: string;
}): Promise<Attachment> {
  const filePath = raw.path ?? raw.filePath;
  const displayName = raw.displayName ?? "attachment";

  if (!filePath) {
    return { displayName, mimeType: "image/png" };
  }

  try {
    const ext = extname(filePath).slice(1) || "png";
    const mimeType = `image/${ext}`;
    const base64 = (await readFile(filePath)).toString("base64");
    return { displayName, mimeType, base64 };
  } catch {
    // File may no longer exist on disk.
    return { displayName, mimeType: "image/png" };
  }
}

/** Clean up attachments for a session */
export async function cleanupSessionAttachments(sessionId: string): Promise<void> {
  const dir = join(ATTACHMENTS_DIR, sessionId);
  await rm(dir, { recursive: true, force: true }).catch(() => {});
}
