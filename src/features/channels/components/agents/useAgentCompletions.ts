import type { KeyboardEvent, RefObject } from "react";
import { useMutation } from "@tanstack/react-query";
import { agentHandleFromName } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { useCompletions } from "@/shared/composers/completions/useCompletions";
import { agentCompletionSource } from "./agentCompletionSource";
import type { AgentPickerSuggestion } from "./agentPickerSuggestions";

/** Agent suggestions and creation for one Channel composer. */
export function useAgentCompletions({
  value,
  onValueChange,
  textareaRef,
  suggestionsFor,
  channelId,
}: {
  value: string;
  onValueChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  suggestionsFor: (query: string) => AgentPickerSuggestion[];
  channelId: string;
}) {
  const completions = useCompletions({
    value,
    onValueChange,
    textareaRef,
    sources: [agentCompletionSource],
  });
  const { active } = completions;
  const createMember = useMutation(channelMutations.createMember());
  const matchingSuggestions = active ? suggestionsFor(active.query) : [];
  const newAgentName =
    active && !matchingSuggestions.some(({ handle }) => handle === active.query)
      ? nameFromMentionQuery(active.query)
      : undefined;
  const createSuggestion: AgentPickerSuggestion | undefined =
    active && newAgentName
      ? {
          handle: active.query,
          name: newAgentName,
          description: "Create and onboard through this conversation",
          group: "New member",
          kind: "create",
        }
      : undefined;
  const suggestions = createSuggestion
    ? [...matchingSuggestions, createSuggestion]
    : matchingSuggestions;

  function selectSuggestion(suggestion: AgentPickerSuggestion): void {
    if (suggestion.kind !== "create") {
      completions.insert(`@${suggestion.handle}`);
      return;
    }
    if (createMember.isPending) return;
    createMember.mutate(
      { channelId, name: suggestion.name },
      { onSuccess: (agent) => completions.insert(`@${agentHandleFromName(agent.name)}`) },
    );
  }

  return {
    isOpen: active !== undefined,
    suggestions,
    activeIndex: completions.activeIndex,
    setActiveIndex: completions.setActiveIndex,
    selectSuggestion,
    error: createMember.error,
    handleChange: completions.handleChange,
    handleSelect: completions.handleSelect,
    /** Returns true when the mention workflow consumed the key. */
    handleKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) =>
      completions.handleKeyDown(event, suggestions.length, (index) =>
        selectSuggestion(suggestions[index]!),
      ),
    close: completions.close,
  };
}

function nameFromMentionQuery(query: string): string | undefined {
  const words = query.split("-").filter(Boolean);
  if (words.length === 0) return undefined;
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}
