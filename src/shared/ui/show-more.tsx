import { useEffect, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/shared/utils";

/**
 * Collapsed content the reader can expand. Style the element with `collapsed`, and with `clamped`
 * when collapsing cuts it off. Clamping depends on rendered width, so the element is re-measured as
 * it resizes, and whenever `content` changes. `toggle` is offered only when it would reveal
 * something, or to collapse again.
 */
export function useShowMore(ref: RefObject<HTMLElement | null>, content: unknown, enabled = true) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClamped, setIsClamped] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setIsClamped(element.scrollHeight > element.clientHeight),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, content]);

  const collapsed = enabled && !isExpanded;
  return {
    collapsed,
    clamped: collapsed && isClamped,
    toggle:
      enabled && (isClamped || isExpanded)
        ? { expanded: isExpanded, onToggle: () => setIsExpanded(!isExpanded) }
        : undefined,
  };
}

export function ShowMore({
  expanded,
  onToggle,
  className,
}: {
  expanded: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const Chevron = expanded ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className={cn(
        "mt-1 inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground hover:text-foreground",
        className,
      )}
      onClick={onToggle}
    >
      {expanded ? "Show less" : "Show more"}
      <Chevron aria-hidden className="size-3.5" />
    </button>
  );
}
