import { describe, expect, test } from "bun:test";
import { agentCompletionSource } from "./agentCompletionSource";

describe("agentCompletionSource", () => {
  test("matches agent handles at mention boundaries", () => {
    expect(agentCompletionSource.match("Ask (@Res", 9)).toEqual({
      start: 5,
      end: 9,
      query: "res",
    });
    expect(agentCompletionSource.match("mail dev@example", 16)).toBeUndefined();
    expect(agentCompletionSource.match("Ask @critic next", 8)).toEqual({
      start: 4,
      end: 11,
      query: "cri",
    });
  });
});
