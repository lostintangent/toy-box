import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { ScrollableFade } from "@/shared/ui/scrollable-fade";
import { SectionHeading } from "@/shared/ui/section-heading";
import { Skeleton } from "@/shared/ui/skeleton";
import { cn } from "@/shared/utils";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { createScreenPane, filterScreenWindows, type Screen } from "../model";
import { getScreenThumbnail, listScreens } from "../server/functions";

/** Picks a display or window to open, by how each looks right now. */
export function ScreenBrowserDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { reveal } = useWorkspaceSurface();
  function openScreen(screenId: string) {
    reveal(createScreenPane(screenId));
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[85vh] grid-rows-[auto_auto_minmax(0,1fr)] gap-3 p-4 sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="text-sm">Open a screen</DialogTitle>
        </DialogHeader>
        <ScreenBrowser onOpen={openScreen} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * One opening of the browser, mounted with the dialog's content: a new search over the
 * screens as they are now.
 */
function ScreenBrowser({ onOpen }: { onOpen: (screenId: string) => void }) {
  const [query, setQuery] = useState("");
  const { data, error } = useQuery({
    queryKey: ["screens"],
    queryFn: () => listScreens(),
    retry: false,
    staleTime: 0,
  });
  const windows = filterScreenWindows(data?.windows ?? [], query);
  return (
    <>
      <Input
        autoFocus
        aria-label="Search windows"
        placeholder="Search windows"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ScrollableFade axis="vertical" rootClassName="min-h-0">
        {error ? (
          <p role="alert" className="p-4 text-sm text-destructive">
            {error.message}
          </p>
        ) : (
          <div className="flex flex-col gap-4 p-0.5">
            <ScreenSection
              title="Displays"
              count={data?.displays.length}
              className="grid-cols-1 sm:grid-cols-2"
            >
              {data?.displays.map((display) => (
                <ScreenCard key={display.id} screen={display} onOpen={onOpen} />
              )) ?? <ScreenCardSkeleton />}
            </ScreenSection>
            <ScreenSection
              title="Windows"
              count={data && windows.length}
              className="grid-cols-2 sm:grid-cols-3"
            >
              {data
                ? windows.map((window) => (
                    <ScreenCard
                      key={window.id}
                      screen={window}
                      detail={window.application}
                      onOpen={onOpen}
                    />
                  ))
                : Array.from({ length: 4 }, (_, index) => <ScreenCardSkeleton key={index} />)}
            </ScreenSection>
            {data && windows.length === 0 && (
              <p className="py-6 text-center text-sm italic text-muted-foreground">
                No windows found
              </p>
            )}
          </div>
        )}
      </ScrollableFade>
    </>
  );
}

function ScreenSection({
  title,
  count,
  className,
  children,
}: {
  title: string;
  /** Unknown while the screens load. */
  count?: number;
  className: string;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="flex flex-col gap-2">
      <SectionHeading title={title} count={count ?? "…"} />
      <div className={cn("grid gap-3", className)}>{children}</div>
    </section>
  );
}

/** A screen as it looked when the browser opened, which opens it. */
function ScreenCard({
  screen,
  detail,
  onOpen,
}: {
  screen: Screen;
  detail?: string;
  onOpen: (screenId: string) => void;
}) {
  const { data: thumbnail, isPending } = useQuery({
    queryKey: ["screens", screen.id, "thumbnail"],
    queryFn: () => getScreenThumbnail({ data: screen.id }),
    retry: false,
    staleTime: 0,
  });
  return (
    <button
      type="button"
      onClick={() => onOpen(screen.id)}
      className="group flex min-w-0 flex-col gap-1.5 rounded-lg text-left outline-none"
    >
      <div className="aspect-[16/10] w-full overflow-hidden rounded-md border bg-muted/40 transition-shadow group-hover:ring-2 group-hover:ring-accent/80 group-focus-visible:ring-2 group-focus-visible:ring-accent">
        {thumbnail ? (
          <img src={thumbnail} alt="" className="size-full object-contain" />
        ) : (
          isPending && <Skeleton className="size-full rounded-none" />
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="truncate text-sm font-medium">{screen.title}</p>
        {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
      </div>
    </button>
  );
}

function ScreenCardSkeleton() {
  return (
    <div className="flex flex-col gap-1.5" aria-hidden>
      <Skeleton className="aspect-[16/10] w-full" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}
