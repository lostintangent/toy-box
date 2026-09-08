import {
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";
import { useMutation } from "@tanstack/react-query";
import { agentHandleFromName, findAgentMentionToken, type AgentMentionToken } from "@agents/model";
import { agentMutations } from "@agents/mutations";
import type { AgentPickerSuggestion } from "./agentPickerSuggestions";

/** Shared keyboard/caret workflow for operational @mentions in any agent host composer. */
export function useAgentMentionInput({
  value,
  onValueChange,
  textareaRef,
  enabled = true,
  suggestionsFor,
}: {
  value: string;
  onValueChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  enabled?: boolean;
  suggestionsFor: (query: string) => AgentPickerSuggestion[];
}) {
  const [token, setToken] = useState<AgentMentionToken>();
  const [activeIndex, setActiveIndex] = useState(0);
  const createAgent = useMutation(agentMutations.create());
  const matchingSuggestions = token ? suggestionsFor(token.query) : [];
  const newAgentName =
    token && !matchingSuggestions.some(({ handle }) => handle === token.query)
      ? nameFromMentionQuery(token.query)
      : undefined;
  const createSuggestion: AgentPickerSuggestion | undefined =
    token && newAgentName
      ? {
          handle: token.query,
          name: newAgentName,
          description: "Create and onboard through this conversation",
          group: "New agent",
          kind: "create",
        }
      : undefined;
  const suggestions = createSuggestion
    ? [...matchingSuggestions, createSuggestion]
    : matchingSuggestions;

  function updateToken(nextValue: string, caret: number | null): void {
    const next = enabled ? findAgentMentionToken(nextValue, caret ?? nextValue.length) : undefined;
    if (next?.start !== token?.start || next?.end !== token?.end || next?.query !== token?.query) {
      setActiveIndex(0);
    }
    setToken(next);
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const { value: nextValue, selectionStart } = event.currentTarget;
    onValueChange(nextValue);
    updateToken(nextValue, selectionStart);
  }

  function handleSelect(event: SyntheticEvent<HTMLTextAreaElement>): void {
    const { value: nextValue, selectionStart } = event.currentTarget;
    updateToken(nextValue, selectionStart);
  }

  function insert(handle: string): void {
    if (!token) return;
    const next = value.slice(0, token.start) + `@${handle} ` + value.slice(token.end);
    const nextCaret = token.start + handle.length + 2;
    onValueChange(next);
    setToken(undefined);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }

  function selectSuggestion(suggestion: AgentPickerSuggestion): void {
    if (suggestion.kind !== "create") {
      insert(suggestion.handle);
      return;
    }
    if (createAgent.isPending) return;
    createAgent.mutate(
      { name: suggestion.name },
      { onSuccess: (agent) => insert(agentHandleFromName(agent.name)) },
    );
  }

  /** Returns true when the mention workflow consumed the key. */
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (token && suggestions.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActiveIndex(
          (current) => (current + direction + suggestions.length) % suggestions.length,
        );
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        selectSuggestion(suggestions[activeIndex] ?? suggestions[0]!);
        return true;
      }
    }
    if (token && event.key === "Escape") {
      event.preventDefault();
      setToken(undefined);
      return true;
    }
    return false;
  }

  return {
    isOpen: token !== undefined,
    suggestions,
    activeIndex,
    setActiveIndex,
    selectSuggestion,
    error: createAgent.error,
    handleChange,
    handleSelect,
    handleKeyDown,
    close: () => setToken(undefined),
  };
}

function nameFromMentionQuery(query: string): string | undefined {
  const words = query.split("-").filter(Boolean);
  if (words.length === 0) return undefined;
  return words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}
