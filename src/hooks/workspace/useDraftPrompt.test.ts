import { describe, expect, test } from "bun:test";
import type { DraftPrompt } from "@/types";
import { DRAFT_PROMPT_SERVER_ORIGIN } from "@/lib/session/constants";
import { shouldAdoptDraftPrompt } from "./useDraftPrompt";

function prompt(text: string, origin: string): DraftPrompt {
  return {
    text,
    origin,
    updatedAt: Date.now(),
  };
}

describe("draft prompt adoption", () => {
  test("applies initial, remote, and server-origin prompts but suppresses own echoes", () => {
    const origin = "client-a";

    expect(shouldAdoptDraftPrompt(prompt("initial", origin), origin, false)).toBe(true);
    expect(shouldAdoptDraftPrompt(prompt("own echo", origin), origin, true)).toBe(false);
    expect(shouldAdoptDraftPrompt(prompt("remote edit", "client-b"), origin, true)).toBe(true);
    expect(shouldAdoptDraftPrompt(prompt("", DRAFT_PROMPT_SERVER_ORIGIN), origin, true)).toBe(true);
  });

  test("ignores missing server state after local edits but adopts it before editing", () => {
    expect(shouldAdoptDraftPrompt(null, "client-a", false)).toBe(true);
    expect(shouldAdoptDraftPrompt(null, "client-a", true)).toBe(false);
  });
});
