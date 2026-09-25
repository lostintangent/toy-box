import type { CompletionSource } from "@/shared/composers/completions/useCompletions";

export const agentCompletionSource = {
  id: "agent",
  match(value, caret) {
    const prefix = value.slice(0, caret);
    const match = /(?:^|[^a-z0-9-])@([a-z0-9-]*)$/i.exec(prefix);
    if (!match) return undefined;
    const query = match[1] ?? "";
    const suffix = /^[a-z0-9-]*/i.exec(value.slice(caret))![0];
    return {
      start: prefix.length - query.length - 1,
      end: caret + suffix.length,
      query: query.toLowerCase(),
    };
  },
} satisfies CompletionSource;
