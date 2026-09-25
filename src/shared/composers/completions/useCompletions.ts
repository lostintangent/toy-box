import {
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";

type CompletionMatch = { start: number; end: number; query: string };

export type CompletionSource = {
  id: string;
  /** Match the completion token surrounding the caret. */
  match: (value: string, caret: number) => CompletionMatch | undefined;
};

type ActiveCompletion = CompletionMatch & { source: string };

/** Shared caret, insertion, and keyboard behavior for composer completions. */
export function useCompletions({
  value,
  onValueChange,
  textareaRef,
  sources,
}: {
  value: string;
  onValueChange: (value: string) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  sources: readonly CompletionSource[];
}) {
  const [interaction, setInteraction] = useState<{
    value: string;
    caret: number;
    dismissed: boolean;
  }>();
  const [navigation, setNavigation] = useState<ActiveCompletion & { index: number }>();
  const match =
    interaction?.value === value ? findCompletion(value, interaction.caret, sources) : undefined;
  const active = interaction?.dismissed ? undefined : match;
  const activeIndex =
    active && navigation && sameCompletion(active, navigation) ? navigation.index : 0;
  const current = useRef({ active, value, onValueChange });

  useLayoutEffect(() => {
    current.current = { active, value, onValueChange };
  }, [active, value, onValueChange]);

  function track(nextValue: string, caret: number | null): void {
    const nextCaret = caret ?? nextValue.length;
    const next = findCompletion(nextValue, nextCaret, sources);
    if (!sameCompletion(match, next)) setNavigation(undefined);
    setInteraction((current) => ({
      value: nextValue,
      caret: nextCaret,
      dismissed:
        current?.dismissed === true &&
        sameCompletion(findCompletion(current.value, current.caret, sources), next),
    }));
  }

  function handleChange(event: ChangeEvent<HTMLTextAreaElement>): void {
    const { value: text, selectionStart } = event.currentTarget;
    onValueChange(text);
    track(text, selectionStart);
  }

  function handleSelect(event: SyntheticEvent<HTMLTextAreaElement>): void {
    const { value: text, selectionStart } = event.currentTarget;
    track(text, selectionStart);
  }

  function close(): void {
    setInteraction((current) => (current ? { ...current, dismissed: true } : undefined));
    setNavigation(undefined);
  }

  /** Replace the active query with `replacement` and leave the caret after a trailing space. */
  function insert(replacement: string): void {
    const latest = current.current;
    if (!active || value !== latest.value || !sameCompletion(active, latest.active)) return;
    const text = `${replacement} `;
    const caret = active.start + text.length;
    latest.onValueChange(
      latest.value.slice(0, active.start) + text + latest.value.slice(active.end),
    );
    setInteraction(undefined);
    setNavigation(undefined);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  }

  /** Move through `count` suggestions and pick one; returns whether the key was consumed. */
  function handleKeyDown(
    event: KeyboardEvent<HTMLTextAreaElement>,
    count: number,
    pick: (index: number) => void,
  ): boolean {
    if (!active) return false;
    if (count > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setNavigation({ ...active, index: (activeIndex + step + count) % count });
      return true;
    }
    if (count > 0 && (event.key === "Enter" || event.key === "Tab")) {
      event.preventDefault();
      pick(Math.min(activeIndex, count - 1));
      return true;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return true;
    }
    return false;
  }

  return {
    active,
    activeIndex,
    setActiveIndex: (index: number) => {
      if (active) setNavigation({ ...active, index });
    },
    handleChange,
    handleSelect,
    insert,
    handleKeyDown,
    close,
  };
}

function findCompletion(
  value: string,
  caret: number,
  sources: readonly CompletionSource[],
): ActiveCompletion | undefined {
  const boundedCaret = Math.max(0, Math.min(value.length, caret));
  for (const source of sources) {
    const match = source.match(value, boundedCaret);
    if (match) return { source: source.id, ...match };
  }
}

function sameCompletion(
  left: ActiveCompletion | undefined,
  right: ActiveCompletion | undefined,
): boolean {
  return (
    left?.source === right?.source &&
    left?.start === right?.start &&
    left?.end === right?.end &&
    left?.query === right?.query
  );
}
