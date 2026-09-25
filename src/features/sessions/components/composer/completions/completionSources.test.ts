import { describe, expect, test } from "bun:test";
import { fileCompletionSource, skillCompletionSource } from "./completionSources";

describe("prompt completion sources", () => {
  test("skills match only at the beginning of a prompt", () => {
    expect(skillCompletionSource.match("/rev", 4)).toEqual({ start: 0, end: 4, query: "rev" });
    expect(skillCompletionSource.match("/", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(skillCompletionSource.match("/review now", 11)).toBeUndefined();
    expect(skillCompletionSource.match("see /rev", 8)).toBeUndefined();
    expect(skillCompletionSource.match("/review later", 4)).toEqual({
      start: 0,
      end: 7,
      query: "rev",
    });
  });

  test("files match after whitespace and include path separators", () => {
    expect(fileCompletionSource.match("compare @src/fea", 16)).toEqual({
      start: 8,
      end: 16,
      query: "src/fea",
    });
    expect(fileCompletionSource.match("@", 1)).toEqual({ start: 0, end: 1, query: "" });
    expect(fileCompletionSource.match("open @notes.md please", 9)).toEqual({
      start: 5,
      end: 14,
      query: "not",
    });
  });

  test("files stop at whitespace and ignore email addresses", () => {
    expect(fileCompletionSource.match("@notes.md and more", 18)).toBeUndefined();
    expect(fileCompletionSource.match("mail me@example.com", 19)).toBeUndefined();
  });
});
