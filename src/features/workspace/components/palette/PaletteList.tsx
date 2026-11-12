import {
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { Check, ChevronRight, LoaderCircle } from "lucide-react";
import type { TextRange } from "@/shared/commands/search";
import { cn } from "@/shared/utils";
import type { PaletteItem, PaletteSection } from "./palette";

/** The DOM id of the option at `index`, which the field names as its active descendant. */
export const paletteOptionId = (listId: string, index: number) => `${listId}-option-${index}`;

/**
 * The open page's results as a listbox. Focus stays in the palette's field, which moves the
 * selection; a mouse selects by moving (not by the list scrolling beneath it), so a touch drag
 * scrolls without selecting, and any pointer runs by clicking. The list eases to the height of its
 * results.
 */
export function PaletteList({
  id,
  sections,
  selectedIndex,
  pendingId,
  empty,
  onSelect,
  onRun,
}: {
  id: string;
  sections: readonly PaletteSection[];
  selectedIndex: number;
  pendingId?: string;
  empty: string;
  onSelect: (item: PaletteItem) => void;
  onRun: (item: PaletteItem, event: MouseEvent) => void;
}) {
  const headingId = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // A height set from the content's size can transition, which a height of `auto` can't.
  useLayoutEffect(() => {
    const list = listRef.current;
    const content = contentRef.current;
    if (!list || !content) return;
    const observer = new ResizeObserver(([entry]) => {
      const height = entry?.borderBoxSize[0]?.blockSize ?? content.offsetHeight;
      list.style.setProperty("--palette-list-height", `${height}px`);
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    // The first result scrolls its section's heading into view too.
    if (selectedIndex <= 0) listRef.current?.scrollTo({ top: 0 });
    else
      document
        .getElementById(paletteOptionId(id, selectedIndex))
        ?.scrollIntoView({ block: "nearest" });
  }, [id, selectedIndex]);

  const offsets = sections.map((_, sectionIndex) =>
    sections.slice(0, sectionIndex).reduce((count, { matches }) => count + matches.length, 0),
  );

  return (
    <div
      ref={listRef}
      id={id}
      role="listbox"
      aria-label="Results"
      className="h-[min(var(--palette-list-height),min(60vh,480px))] overflow-y-auto overscroll-contain transition-[height] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none max-md:h-[min(var(--palette-list-height),45dvh)]"
    >
      <div ref={contentRef} className="p-1.5">
        {sections.length === 0 ? (
          <div className="px-3 py-8 text-center text-sm text-muted-foreground">{empty}</div>
        ) : (
          sections.map(({ heading, matches }, sectionIndex) => {
            const sectionHeadingId = `${headingId}-${sectionIndex}`;
            return (
              <div
                key={heading ?? matches[0]?.item.id}
                role="group"
                aria-labelledby={heading ? sectionHeadingId : undefined}
                className="not-first:mt-1"
              >
                {heading && (
                  <div
                    id={sectionHeadingId}
                    className="px-3 pt-2.5 pb-1 text-2xs font-medium tracking-wide text-muted-foreground"
                  >
                    {heading}
                  </div>
                )}
                {matches.map(({ item, titleRanges }, matchIndex) => {
                  const itemIndex = offsets[sectionIndex]! + matchIndex;
                  const selected = itemIndex === selectedIndex;
                  return (
                    <PaletteRow
                      key={item.id}
                      id={paletteOptionId(id, itemIndex)}
                      item={item}
                      titleRanges={titleRanges}
                      selected={selected}
                      pending={item.id === pendingId}
                      onPointerMove={(event) => {
                        if (event.pointerType === "mouse" && !selected && !item.disabled) {
                          onSelect(item);
                        }
                      }}
                      onClick={(event) => onRun(item, event)}
                    />
                  );
                })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function PaletteRow({
  id,
  item,
  titleRanges,
  selected,
  pending,
  onPointerMove,
  onClick,
}: {
  id: string;
  item: PaletteItem;
  titleRanges: readonly TextRange[];
  selected: boolean;
  pending: boolean;
  onPointerMove: (event: PointerEvent) => void;
  onClick: (event: MouseEvent) => void;
}) {
  const Icon = item.icon;
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-disabled={item.disabled || undefined}
      data-selected={selected || undefined}
      onPointerMove={onPointerMove}
      // The field keeps focus, so typing continues after a click.
      onMouseDown={(event) => event.preventDefault()}
      onClick={item.disabled ? undefined : onClick}
      className={cn(
        "flex h-10 cursor-default select-none items-center gap-3 rounded-lg px-3 text-sm",
        selected && "bg-accent/50 text-accent-foreground",
        item.disabled && "opacity-50",
        item.destructive && "text-destructive",
      )}
    >
      <span
        className={cn(
          "flex size-4 shrink-0 items-center justify-center",
          !item.destructive && "text-muted-foreground",
          selected && !item.destructive && "text-accent-foreground",
        )}
      >
        {pending ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : isValidElement(Icon) ? (
          Icon
        ) : (
          Icon && <Icon className="size-4" />
        )}
      </span>
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 shrink truncate">
          <Highlighted text={item.title} ranges={titleRanges} />
        </span>
        {item.detail && (
          <span className="min-w-0 shrink-[3] truncate text-xs text-muted-foreground">
            {item.detail}
          </span>
        )}
      </span>
      {item.accessory !== undefined && (
        <span className="shrink-0 text-xs text-muted-foreground">{item.accessory}</span>
      )}
      {/* A toggle's title already says what running it does, so only a choice shows its check. */}
      {item.choose && item.checked && <Check className="size-4 shrink-0" />}
      {item.shortcut && (
        <kbd
          className="shrink-0 font-sans text-xs tracking-widest text-muted-foreground max-md:hidden"
          suppressHydrationWarning
        >
          {formatForDisplay(item.shortcut)}
        </kbd>
      )}
      {item.page && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
    </div>
  );
}

function Highlighted({ text, ranges }: { text: string; ranges: readonly TextRange[] }) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const [start, end] of ranges) {
    parts.push(
      text.slice(cursor, start),
      <mark key={start} className="bg-transparent font-semibold text-current">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  parts.push(text.slice(cursor));
  return parts;
}
