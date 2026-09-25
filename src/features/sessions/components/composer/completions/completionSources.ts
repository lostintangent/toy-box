import type { CompletionSource } from "@/shared/composers/completions/useCompletions";

export const skillCompletionSource = {
  id: "skill",
  match(value, caret) {
    const prefix = value.slice(0, caret);
    const match = /^\/([^\s/]*)$/.exec(prefix);
    if (!match) return undefined;
    const suffix = /^[^\s/]*/.exec(value.slice(caret))![0];
    return { start: 0, end: caret + suffix.length, query: match[1]! };
  },
} satisfies CompletionSource;

export const fileCompletionSource = {
  id: "file",
  match(value, caret) {
    const prefix = value.slice(0, caret);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(prefix);
    if (!match) return undefined;
    const query = match[1]!;
    const suffix = /^[^\s@]*/.exec(value.slice(caret))![0];
    return { start: prefix.length - query.length - 1, end: caret + suffix.length, query };
  },
} satisfies CompletionSource;
