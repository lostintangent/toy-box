import { expect, onTestFinished, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deleteChannelFiles, storeChannelAvatar, uniqueAttachmentNames } from "./attachments";

test("repeated attachment names gain a suffix before their extension, ignoring case", () => {
  expect(
    uniqueAttachmentNames(["image.png", "shot.png", "Image.png", "image.png", "notes", "notes"]),
  ).toEqual(["image.png", "shot.png", "Image-2.png", "image-3.png", "notes", "notes-2"]);
  expect(uniqueAttachmentNames(["a.png", "a.png", "a-2.png"])).toEqual([
    "a.png",
    "a-2.png",
    "a-2-2.png",
  ]);
});

/** Avatars land in the real home, which Bun resolves once per process. */
async function avatarChannel() {
  const channelId = crypto.randomUUID();
  const sources = await mkdtemp(join(tmpdir(), "toy-box-avatar-"));
  onTestFinished(async () => {
    await Promise.all([deleteChannelFiles(channelId), rm(sources, { recursive: true })]);
  });
  const store = async (name: string, content: string | Uint8Array) => {
    await Bun.write(join(sources, name), content);
    return storeChannelAvatar(channelId, join(sources, name));
  };
  return { store };
}

test("an avatar image is stored under a name its content fixes", async () => {
  const { store } = await avatarChannel();
  const name = await store("Icon.PNG", "first");
  expect(name).toMatch(/^avatar-[0-9a-f]{16}\.png$/);
  expect(await store("copy.png", "first")).toBe(name);
  expect(await store("icon.png", "second")).not.toBe(name);
});

test("an avatar image is a PNG, JPEG, or WebP of at most 256 KB", async () => {
  const { store } = await avatarChannel();
  await expect(store("icon.svg", "<svg/>")).rejects.toThrow("PNG, JPEG, or WebP");
  await expect(store("icon.png", new Uint8Array(256 * 1024 + 1))).rejects.toThrow("256 KB");
  expect(await store("icon.webp", new Uint8Array(256 * 1024))).toEndWith(".webp");
});
