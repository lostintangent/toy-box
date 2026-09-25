// Both directions of the SDK's blob attachment wire shape live here so the
// writer (outbound prompt attachments) and the reader (persisted user.message
// records) can never drift.

import type { Attachment as SdkAttachment, MessageOptions } from "@github/copilot-sdk";
import type { Attachment } from "@/shared/attachments/model";

/** Domain attachments → SDK blobs, for session.send. */
export function toSdkAttachments(
  attachments?: Attachment[],
): MessageOptions["attachments"] | undefined {
  return attachments?.length
    ? attachments.map((attachment) => ({
        type: "blob",
        data: attachment.base64,
        mimeType: attachment.mimeType,
      }))
    : undefined;
}

/** Resolve inline blobs and native binary-asset references from SDK history. */
export function fromSdkAttachments(
  value: SdkAttachment[] | undefined,
  assets: ReadonlyMap<string, Attachment>,
): Attachment[] | undefined {
  if (!value?.length) return undefined;

  const attachments = value.flatMap((entry) => {
    if (entry.type === "blob" && typeof entry.data === "string")
      return [{ base64: entry.data, mimeType: entry.mimeType }];
    const asset =
      (entry.type === "blob" || entry.type === "file") && entry.assetId
        ? assets.get(entry.assetId)
        : undefined;
    return asset ? [asset] : [];
  });
  return attachments.length ? attachments : undefined;
}
