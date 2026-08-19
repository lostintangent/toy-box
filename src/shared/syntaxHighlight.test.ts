import { expect, test } from "bun:test";
import { getLangFromPath, highlightCode } from "./syntaxHighlight";

test("highlights bundled and aliased languages while preserving source text", async () => {
  const sql = "SELECT id\nFROM sessions;\n";
  const highlighted = await highlightCode(sql, "sql");

  expect(highlighted).not.toBeNull();
  expect(
    highlighted?.map((line) => line.tokens.map((token) => token.content).join("")).join("\n"),
  ).toBe(sql);
  expect(highlighted?.flatMap((line) => line.tokens).some((token) => token.color)).toBe(true);

  const shell = await highlightCode("echo ready", "shell");
  expect(
    shell
      ?.flatMap((line) => line.tokens)
      .map((token) => token.content)
      .join(""),
  ).toBe("echo ready");
  expect(getLangFromPath("scripts/restore.sh")).toBe("bash");
});

test("falls back to exact plain text for an unbundled language", async () => {
  const source = "custom := exact";
  const highlighted = await highlightCode(source, "made-up-language");

  expect(
    highlighted
      ?.flatMap((line) => line.tokens)
      .map((token) => token.content)
      .join(""),
  ).toBe(source);
});
