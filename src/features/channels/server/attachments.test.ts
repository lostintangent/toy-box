import { expect, test } from "bun:test";
import { uniqueAttachmentNames } from "./attachments";

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
