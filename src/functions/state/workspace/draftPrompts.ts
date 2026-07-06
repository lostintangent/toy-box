// Draft prompt storage for server workspace state.
//
// A draft prompt is unsent text for a draft or real session. The state is
// shared across clients. Public transitions and broadcasts are composed by
// ./index.ts.

import type { DraftPrompt } from "@/types";
import { sharedMap } from "../../runtime/processState";

const DRAFT_PROMPT_TTL_MS = 24 * 60 * 60 * 1000;

const draftPrompts = sharedMap<DraftPrompt>("draft-prompts");

function isDraftPromptFresh(prompt: DraftPrompt, now: number = Date.now()): boolean {
  return now - prompt.updatedAt < DRAFT_PROMPT_TTL_MS;
}

export function getDraftPrompt(sessionId: string, now: number = Date.now()): DraftPrompt | null {
  const prompt = draftPrompts.get(sessionId);
  if (!prompt) return null;
  if (isDraftPromptFresh(prompt, now)) return prompt;
  draftPrompts.delete(sessionId);
  return null;
}

export function getDraftPromptsBySessionId(now: number = Date.now()): Record<string, DraftPrompt> {
  const prompts: Record<string, DraftPrompt> = {};
  for (const [sessionId, prompt] of draftPrompts) {
    if (!isDraftPromptFresh(prompt, now)) {
      draftPrompts.delete(sessionId);
      continue;
    }
    prompts[sessionId] = prompt;
  }
  return prompts;
}

export function setDraftPromptRecord(sessionId: string, text: string, origin: string): DraftPrompt {
  const prompt: DraftPrompt = {
    text,
    origin,
    updatedAt: Date.now(),
  };
  draftPrompts.set(sessionId, prompt);
  return prompt;
}

export function deleteDraftPromptState(sessionId: string): boolean {
  return draftPrompts.delete(sessionId);
}
