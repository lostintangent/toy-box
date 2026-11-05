import {
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { Dialog } from "@base-ui/react/dialog";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import { ChevronLeft, Search } from "lucide-react";
import { ALTERNATE_SHORTCUT, executeCommand, getAlternateAction } from "@/shared/commands/command";
import { recordCommandUsage } from "@/shared/commands/usage";
import { useMediaQuery } from "@/shared/hooks/useMediaQuery";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/utils";
import {
  initialPaletteState,
  reducePalette,
  resolveSelection,
  type PalettePageKind,
  type PaletteAction,
  type PaletteItem,
  type PaletteState,
} from "./palette";
import { PaletteList, paletteOptionId } from "./PaletteList";
import { usePaletteView, type PaletteData } from "./usePaletteView";

/** How long a row is selected before it shows its preview, and then before the next one does. */
const PEEK_DELAY_MS = 500;
const PEEK_FOLLOW_DELAY_MS = 150;
/** A run that finishes sooner than this shows no progress, so instant commands don't flicker. */
const PENDING_DELAY_MS = 100;

/**
 * The workspace's command palette: one field to find anything in it, run any command, or start new
 * work from what's typed. Its pages (a group, a file search, an item's actions, an option for new
 * work) stack beneath the field, and backing out returns to each as it was.
 */
export function CommandPalette({
  open,
  onOpenChange,
  ...data
}: { open: boolean; onOpenChange: (open: boolean) => void } & PaletteData) {
  const [state, dispatch] = useReducer(reducePalette, initialPaletteState);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen, details) => {
        // Escape backs out of a page before it closes the palette.
        if (!nextOpen && details.reason === "escape-key" && state.stack.length > 1) {
          details.cancel();
          dispatch({ type: "back" });
          return;
        }
        onOpenChange(nextOpen);
      }}
      // Each opening starts fresh, once the last has animated away.
      onOpenChangeComplete={(nextOpen) => {
        if (!nextOpen) dispatch({ type: "reset" });
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200 data-[ending-style]:opacity-0 data-[ending-style]:duration-150 data-[starting-style]:opacity-0 dark:bg-black/50" />
        <Dialog.Popup
          // Base UI would focus the field a frame later, after an opening tap ends and too late for
          // iOS to raise the keyboard, so the field is focused as soon as the dialog is ready.
          initialFocus={() => {
            inputRef.current?.focus();
            return false;
          }}
          aria-label="Command palette"
          className={cn(
            "fixed top-[12vh] left-1/2 z-50 w-[min(640px,calc(100vw-2rem))] origin-top -translate-x-1/2 outline-none",
            "transition-[opacity,scale,translate] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-opacity",
            "data-[starting-style]:-translate-y-2 data-[starting-style]:scale-[0.97] data-[starting-style]:opacity-0",
            "data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[ending-style]:duration-150 data-[ending-style]:ease-in",
            "max-md:top-2 max-md:w-[calc(100vw-1rem)]",
          )}
        >
          <PaletteContent
            state={state}
            dispatch={dispatch}
            data={data}
            inputRef={inputRef}
            onClose={() => onOpenChange(false)}
          />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PaletteContent({
  state,
  dispatch,
  data,
  inputRef,
  onClose,
}: {
  state: PaletteState;
  dispatch: Dispatch<PaletteAction>;
  data: PaletteData;
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
}) {
  const listId = useId();
  const { isMobile } = useViewport();
  const { stack } = state;
  const top = stack.at(-1)!;
  const view = usePaletteView(state, data, { isMobile });
  const items = view.sections.flatMap(({ matches }) => matches.map(({ item }) => item));
  const selected = resolveSelection(view.sections, top);
  const selectedIndex = selected ? items.indexOf(selected) : -1;
  const alternate = selected && getAlternateAction(selected);
  const [pendingId, setPendingId] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const peek = usePeek(selected, items);

  // A run that finishes after the palette is gone mustn't close a later opening.
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function run(item: PaletteItem | undefined) {
    if (!item || item.disabled || running.current) return;
    if (item.page) {
      dispatch({ type: "open", page: item.page });
      return;
    }
    recordCommandUsage(item.id);
    if (item.choose) {
      dispatch({ type: "choose", options: item.choose });
      return;
    }
    if (!item.run) return;

    setFailure(undefined);
    const command = { id: item.id, title: item.title, run: item.run };

    running.current = true;
    const showPending = setTimeout(() => setPendingId(item.id), PENDING_DELAY_MS);
    const succeeded = await executeCommand(command);
    clearTimeout(showPending);
    running.current = false;
    if (!mounted.current) return;

    setPendingId(undefined);
    if (succeeded) onClose();
    else setFailure(`Couldn't ${(item.verb ?? "run").toLowerCase()} “${item.title}”`);
  }

  function move(offset: number) {
    const enabled = items.filter(({ disabled }) => !disabled);
    if (enabled.length === 0) return;
    const index = selected ? enabled.indexOf(selected) : 0;
    dispatch({
      type: "select",
      id: enabled[(index + offset + enabled.length) % enabled.length]!.id,
    });
  }

  /** What → opens on an item: its actions, or else the page it leads to. */
  const drillInto = (item: PaletteItem | undefined): PalettePageKind | undefined =>
    item?.actions?.length ? { kind: "actions", item } : item?.page;

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    const input = event.currentTarget;
    const caretAtEnd =
      input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

    switch (event.key) {
      case "ArrowDown":
      case "ArrowUp":
        event.preventDefault();
        move(event.key === "ArrowDown" ? 1 : -1);
        return;
      case "Enter":
        event.preventDefault();
        void run(event.metaKey || event.ctrlKey ? (alternate ?? selected) : selected);
        return;
      case "ArrowRight": {
        const page = caretAtEnd && !event.shiftKey ? drillInto(selected) : undefined;
        if (page) {
          event.preventDefault();
          dispatch({ type: "open", page });
        }
        return;
      }
      case "ArrowLeft":
      case "Backspace":
        if (input.value === "" && stack.length > 1) {
          event.preventDefault();
          dispatch({ type: "back" });
        }
        return;
    }
  }

  return (
    <>
      <div className="flex flex-col overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-2xl">
        <div className="flex items-center gap-2 border-b px-3">
          {stack.length > 1 ? (
            <button
              type="button"
              aria-label="Back"
              className="-ml-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => dispatch({ type: "back" })}
            >
              <ChevronLeft className="size-4" />
            </button>
          ) : (
            <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          )}
          {stack.slice(1).map((page, index) => (
            <button
              // eslint-disable-next-line react/no-array-index-key -- a breadcrumb is its place in the stack.
              key={index}
              type="button"
              className="max-w-40 shrink-0 truncate rounded-md bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:text-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => dispatch({ type: "back", index: index + 1 })}
            >
              {pageTitle(page)}
            </button>
          ))}
          <input
            ref={inputRef}
            value={top.query}
            placeholder={view.placeholder}
            onChange={(event) => {
              setFailure(undefined);
              dispatch({ type: "type", query: event.target.value });
            }}
            onKeyDown={handleKeyDown}
            role="combobox"
            aria-expanded
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              selectedIndex >= 0 ? paletteOptionId(listId, selectedIndex) : undefined
            }
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="go"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground max-md:text-base"
          />
        </div>

        <PaletteList
          id={listId}
          sections={view.sections}
          selectedIndex={selectedIndex}
          pendingId={pendingId}
          empty={view.empty}
          onSelect={(item) => dispatch({ type: "select", id: item.id })}
          onRun={(item, event) => {
            const itemAlternate = getAlternateAction(item);
            void run((event.metaKey || event.ctrlKey) && itemAlternate ? itemAlternate : item);
          }}
        />

        {!isMobile && (
          <div className="flex h-9 items-center gap-4 border-t px-3 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1 truncate text-destructive" role="status">
              {failure}
            </span>
            {selected && <Hint keys="↵">{selected.verb ?? (selected.page ? "Open" : "Run")}</Hint>}
            {alternate && (
              <Hint keys={formatForDisplay(ALTERNATE_SHORTCUT)}>{alternate.title}</Hint>
            )}
            {selected?.actions?.length ? <Hint keys="→">Actions</Hint> : null}
            <Hint keys="esc">{stack.length > 1 ? "Back" : "Close"}</Hint>
          </div>
        )}
      </div>

      {peek?.preview && (
        <div className="absolute top-0 left-[calc(100%+12px)] h-[min(70vh,640px)] w-[min(560px,calc(50vw-320px-2rem))] overflow-hidden rounded-xl border bg-background shadow-2xl animate-in fade-in-0 slide-in-from-left-2 duration-200 motion-reduce:animate-none">
          {peek.preview()}
        </div>
      )}
    </>
  );
}

/**
 * The item whose preview shows beside the palette, where there's room: the selected item, once
 * it's been selected for a moment. Moving on from a preview keeps it until the next one shows, so
 * arrowing through rows doesn't flash.
 */
function usePeek(selected: PaletteItem | undefined, items: readonly PaletteItem[]) {
  // Wide enough for a preview beside the palette, which also excludes mobile.
  const roomy = useMediaQuery("(min-width: 1400px)");
  const [peekId, setPeekId] = useState<string>();
  const candidateId = roomy && selected?.preview ? selected.id : undefined;

  useEffect(() => {
    if (!candidateId || candidateId === peekId) return;
    const timer = setTimeout(
      () => setPeekId(candidateId),
      peekId === undefined ? PEEK_DELAY_MS : PEEK_FOLLOW_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [candidateId, peekId]);

  return candidateId ? items.find(({ id }) => id === peekId) : undefined;
}

function Hint({ keys, children }: { keys: string; children: ReactNode }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <kbd className="rounded border bg-muted px-1 font-sans text-2xs" suppressHydrationWarning>
        {keys}
      </kbd>
      {children}
    </span>
  );
}

function pageTitle(page: PalettePageKind): string {
  switch (page.kind) {
    case "root":
      return "Search";
    case "group":
      return page.group;
    case "files":
      return "Files";
    case "actions":
      return page.item.title;
    case "model":
      return "Model";
    case "directory":
      return "Directory";
  }
}
