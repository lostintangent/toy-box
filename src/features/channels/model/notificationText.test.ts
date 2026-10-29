import { expect, test } from "bun:test";
import {
  notificationBodyLimit,
  notificationCompletionBody,
  notificationPlainText,
  notificationRequestBody,
  notificationWaitingBody,
  truncateNotificationText,
} from "./notificationText";

const agents = [{ name: "Lead" }, { name: "Ada Lovelace" }];
const image = { name: "door.png", url: "/door.png" };
const file = { name: "notes.pdf", url: "/notes.pdf" };
const graphemes = (text: string) => [
  ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text),
];

test("request text mirrors Swift's transcript, mentions, links, lists and fenced code", () => {
  const content = `@lead @ada-lovelace, which [entrance](https://example.test/a) should we ship?

- The **arched** one
- The \`flat\` one

\`\`\`
let door = arch
\`\`\``;
  expect(notificationRequestBody({ content }, agents)).toBe(
    "which entrance should we ship?\n\u2022 The arched one\n\u2022 The flat one\nlet door = arch",
  );
  expect(
    notificationPlainText(
      "# **Heading**\n\n> A *quote* &amp; a [link](https://example.test)\n\n---",
    ),
  ).toBe("Heading\nA quote & a link");
  expect(notificationPlainText("| A | B |\n| --- | --- |\n| one | `two` |")).toBe("A  B\none  two");
  expect(notificationRequestBody({ content: "@lead @unknown Keep both." }, agents)).toBe(
    "@lead @unknown Keep both.",
  );
  expect(notificationRequestBody({ content: "@everyone: Ship it." }, agents)).toBe("Ship it.");
});

test("attachment-only and empty requests mirror Swift's exact words", () => {
  expect(notificationRequestBody({ content: "@lead", attachments: [image] }, agents)).toBe(
    "Sent an image",
  );
  expect(notificationRequestBody({ content: "", attachments: [image, image, image] }, agents)).toBe(
    "Sent 3 images",
  );
  expect(notificationRequestBody({ content: "", attachments: [file] }, agents)).toBe("Sent a file");
  expect(notificationRequestBody({ content: "", attachments: [image, file] }, agents)).toBe(
    "Sent 2 files",
  );
  expect(
    notificationRequestBody(
      { content: "@lead", attachments: [{ mimeType: "image/png", base64: "" }] },
      agents,
    ),
  ).toBe("Sent an image");
  expect(notificationRequestBody({ content: "  " }, agents)).toBe(notificationWaitingBody);
  expect(notificationRequestBody({ content: "@unknown" }, agents)).toBe(notificationWaitingBody);
});

test("the 400-character limit preserves graphemes and cuts at the last word like Swift", () => {
  const body = truncateNotificationText("entrance ".repeat(60));
  expect(graphemes(body).length).toBeLessThanOrEqual(notificationBodyLimit);
  expect(body).toEndWith("entrance\u2026");
  expect(truncateNotificationText("Short and sweet.")).toBe("Short and sweet.");
  expect(truncateNotificationText("a".repeat(500))).toBe("a".repeat(399) + "\u2026");
  const family = "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}";
  for (const character of [family, "e\u0301"]) {
    expect(truncateNotificationText(character.repeat(400))).toBe(character.repeat(400));
    const clipped = truncateNotificationText(character.repeat(401));
    expect(graphemes(clipped)).toHaveLength(400);
    expect(clipped).toBe(character.repeat(399) + "\u2026");
  }
});

test("completion text names one top-level task and otherwise counts roots, matching Swift", () => {
  expect(notificationCompletionBody([])).toBe("All tasks completed");
  expect(notificationCompletionBody([{ title: "Ship the door" }])).toBe(
    "Completed \u201cShip the door\u201d",
  );
  expect(notificationCompletionBody([{ title: "A" }, { title: "B" }])).toBe(
    "All 2 tasks completed",
  );
});
