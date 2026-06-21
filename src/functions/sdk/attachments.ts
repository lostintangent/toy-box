// Both directions of the SDK's blob attachment wire shape live here so the
// writer (outbound prompt attachments) and the reader (persisted user.message
// records) can never drift.

import type { Attachment as SdkAttachment, AttachmentBlob } from "@github/copilot-sdk";
import type { Attachment } from "@/types";

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
export function readAttachmentBlobs(value: SdkAttachment[] | undefined): Attachment[] | undefined {
  if (!value?.length) return undefined;

  const attachments = value.flatMap((entry) => {
    if (entry.type !== "blob") return [];

    return [
      {
        base64: entry.data,
        mimeType: entry.mimeType,
        displayName: entry.displayName ?? "attachment",
      },
    ];
  });
  return attachments.length ? attachments : undefined;
}
