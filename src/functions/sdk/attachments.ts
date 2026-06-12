// Both directions of the SDK's blob attachment wire shape live here so the
// writer (outbound prompt attachments) and the reader (persisted user.message
// records) can never drift.

import type { AttachmentBlob } from "@github/copilot-sdk";
import type { Attachment } from "@/types";
import { asRecord, readString } from "./extractors";

/** Attachment → SDK blob, for session.send. */
export function toSdkAttachmentBlobs(attachments?: Attachment[]): AttachmentBlob[] | undefined {
  return attachments?.length
    ? attachments.map((attachment) => ({
        type: "blob",
        data: attachment.base64,
        mimeType: attachment.mimeType,
        displayName: attachment.displayName,
      }))
    : undefined;
}

/** SDK blobs (from a persisted user.message record) → Attachments.
 *  Non-blob entries (e.g. legacy file references) are skipped. */
export function readAttachmentBlobs(value: unknown): Attachment[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;

  const attachments = value.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record || readString(record, "type") !== "blob") return [];

    const base64 = readString(record, "data");
    const mimeType = readString(record, "mimeType");
    if (!base64 || !mimeType) return [];

    return [
      {
        base64,
        mimeType,
        displayName: readString(record, "displayName") ?? "attachment",
      },
    ];
  });
  return attachments.length ? attachments : undefined;
}
