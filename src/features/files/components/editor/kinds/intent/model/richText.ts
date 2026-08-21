const INLINE_RICH_TEXT_PATTERN = /\*\*([^*`\n]+)\*\*|`([^*`\n]+)`/g;

export function intentRichTextSegments(text: string) {
  const segments: Array<{
    offset: number;
    text: string;
    kind: "plain" | "strong" | "code";
  }> = [];
  let cursor = 0;

  for (const match of text.matchAll(INLINE_RICH_TEXT_PATTERN)) {
    const offset = match.index;
    if (offset > cursor) {
      segments.push({
        offset: cursor,
        text: text.slice(cursor, offset),
        kind: "plain",
      });
    }
    segments.push({
      offset,
      text: match[1] ?? match[2] ?? "",
      kind: match[1] === undefined ? "code" : "strong",
    });
    cursor = offset + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({
      offset: cursor,
      text: text.slice(cursor),
      kind: "plain",
    });
  }

  return segments;
}

export function hasValidIntentRichText(text: string): boolean {
  const segments = intentRichTextSegments(text);
  if (segments.some((segment) => segment.kind !== "plain" && !segment.text.trim())) return false;
  const plainText = segments
    .filter((segment) => segment.kind === "plain")
    .map((segment) => segment.text)
    .join("");
  return !plainText.includes("**") && !plainText.includes("`");
}
