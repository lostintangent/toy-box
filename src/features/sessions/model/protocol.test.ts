import { expect, test } from "bun:test";
import { sessionMessageSchema } from "./protocol";

test("a message can contain images without a prompt, but cannot attach documents", () => {
  const message = (mimeType: string) => ({
    content: "",
    attachments: [{ mimeType, base64: "aW1hZ2U=" }],
  });
  expect(sessionMessageSchema.safeParse(message("image/png")).success).toBe(true);
  for (const mimeType of ["text/plain", "application/pdf", "application/octet-stream"])
    expect(sessionMessageSchema.safeParse(message(mimeType)).success).toBe(false);
});
