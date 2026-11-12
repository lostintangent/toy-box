import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import type { Attachment, AttachmentReference } from "@/shared/attachments/model";
import type { ChannelAvatar } from "@channels/model";
import { machineFile } from "@files/model";
import { createFileServeUrl } from "@files/model/paths";

/** Keeps a message's uploads and files in its Channel, so they outlive the files they came from.
 *  A retried post rewrites the same files. Returns the names its message records. */
export async function storeChannelAttachments(
  channelId: string,
  messageId: string,
  attachments: readonly (Attachment | string)[],
): Promise<string[]> {
  const names = uniqueAttachmentNames(
    attachments.map((attachment) =>
      typeof attachment === "string"
        ? basename(attachment)
        : `image.${attachment.mimeType.split(/[/+]/)[1]}`,
    ),
  );
  await Promise.all(
    attachments.map((attachment, index) =>
      Bun.write(
        channelAttachmentPath(channelId, messageId, names[index]!),
        typeof attachment === "string"
          ? Bun.file(attachment)
          : Buffer.from(attachment.base64, "base64"),
      ),
    ),
  );
  return names;
}

/** A message records each attachment's name; its folder in the Channel fixes the rest. */
export function channelAttachmentPath(channelId: string, messageId: string, name: string) {
  return join(channelDirectory(channelId), "attachments", messageId, name);
}

export function channelAttachment(
  channelId: string,
  messageId: string,
  name: string,
): AttachmentReference {
  const path = channelAttachmentPath(channelId, messageId, name);
  return { name, url: createFileServeUrl(machineFile(path)), mimeType: Bun.file(path).type };
}

/** Keeps each name as sent, except that a repeat gains `-2`, `-3` before its extension. Names
 *  compare without case, as they do on the default macOS file system. */
export function uniqueAttachmentNames(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const extension = extname(name);
    const stem = name.slice(0, name.length - extension.length);
    let unique = name;
    for (let suffix = 2; taken.has(unique.toLowerCase()); suffix++) {
      unique = `${stem}-${suffix}${extension}`;
    }
    taken.add(unique.toLowerCase());
    return unique;
  });
}

const AVATAR_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const AVATAR_MAX_BYTES = 256 * 1024;

/** Keeps the lead's chosen image in its Channel under a name its content fixes, so a new image gets
 *  a new URL. Returns the name. */
export async function storeChannelAvatar(channelId: string, path: string): Promise<string> {
  const extension = extname(path).toLowerCase();
  if (!AVATAR_EXTENSIONS.has(extension)) throw new Error("Use a PNG, JPEG, or WebP image.");
  const source = Bun.file(path);
  if (source.size > AVATAR_MAX_BYTES) throw new Error("Use an image of at most 256 KB.");
  const bytes = await source.bytes();
  const hash = new Bun.CryptoHasher("sha256").update(bytes).digest("hex").slice(0, 16);
  const name = `avatar-${hash}${extension}`;
  await Bun.write(join(channelDirectory(channelId), name), bytes);
  return name;
}

/** A Channel's avatar as clients draw it: a mark as chosen, or its stored image's URL. */
export function channelAvatar(channelId: string, avatar: ChannelAvatar): ChannelAvatar {
  return "image" in avatar
    ? { image: createFileServeUrl(machineFile(join(channelDirectory(channelId), avatar.image))) }
    : avatar;
}

export async function deleteChannelFiles(channelId: string) {
  await rm(channelDirectory(channelId), { recursive: true, force: true });
}

function channelDirectory(channelId: string) {
  return join(homedir(), ".toy-box", "channels", channelId);
}
