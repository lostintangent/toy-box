// Both directions of the SDK's blob attachment wire shape live here so the
// writer (outbound prompt attachments) and the reader (persisted user.message
// records) can never drift.

import type { Attachment as SdkAttachment, MessageOptions } from "@github/copilot-sdk";
import type { Attachment } from "@/types";

/** Domain attachments → SDK blobs, for session.send. */
export function toSdkAttachments(
  attachments?: Attachment[],
): MessageOptions["attachments"] | undefined {
  return attachments?.length
    ? attachments.map((attachment) => ({
        type: "blob",
        data: attachment.base64,
        mimeType: attachment.mimeType,
        displayName: attachment.displayName,
      }))
    : undefined;
}

/** SDK blobs (from a persisted user.message record) → domain attachments.
 *  Non-blob entries (e.g. legacy file references) are skipped. */
export function fromSdkAttachments(value: SdkAttachment[] | undefined): Attachment[] | undefined {
  if (!value?.length) return undefined;

  const attachments = value.flatMap((entry) => {
    if (entry.type !== "blob") return [];
    if (typeof entry.data !== "string") return [];

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
