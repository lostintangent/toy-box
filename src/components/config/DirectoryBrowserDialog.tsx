import { useCallback, useEffect, useReducer, useRef } from "react";
import {
  ChevronRight,
  FolderClosed,
  FolderUp,
  Loader2,
  Eye,
  EyeOff,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listDirectory, type DirectoryEntry } from "@/functions/fs";
import { cn } from "@/lib/utils";

type DirectoryBrowserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (directory: string) => void;
  initialPath?: string;
};

export function DirectoryBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  initialPath,
}: DirectoryBrowserDialogProps) {
  const [state, dispatch] = useReducer(directoryBrowserReducer, INITIAL_BROWSER_STATE);
  const requestIdRef = useRef(0);
  const wasOpenRef = useRef(false);
  const { browseState, loading, error, showHidden } = state;

  const navigateTo = useCallback(
    async (path: string | undefined, nextShowHidden: boolean, clearBrowseState = false) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      dispatch({ type: "navigationStarted", requestId, clearBrowseState });

      try {
        const result = await listDirectory({
          data: { path, showHidden: nextShowHidden },
        });
        if (result.status === "ok") {
          dispatch({
            type: "navigationSucceeded",
            requestId,
            browseState: {
              currentPath: result.currentPath,
              parentPath: result.parentPath,
              directories: result.directories,
            },
          });
        } else {
          dispatch({ type: "navigationFailed", requestId, message: result.message });
        }
      } catch {
        dispatch({
          type: "navigationFailed",
          requestId,
          message: "Failed to load directory contents.",
        });
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }
    if (wasOpenRef.current) return;
    wasOpenRef.current = true;
    void navigateTo(initialPath, showHidden, true);
  }, [initialPath, navigateTo, open, showHidden]);

  const handleNavigate = useCallback(
    (path?: string) => {
      void navigateTo(path, showHidden);
    },
    [navigateTo, showHidden],
  );

  const handleShowHiddenToggle = useCallback(() => {
    const nextShowHidden = !showHidden;
    dispatch({ type: "showHiddenChanged", showHidden: nextShowHidden });
    if (open) {
      void navigateTo(browseState?.currentPath ?? initialPath, nextShowHidden, !browseState);
    }
  }, [browseState, initialPath, navigateTo, open, showHidden]);

  const handleSelect = useCallback(() => {
    if (browseState) {
      onSelect(browseState.currentPath);
      onOpenChange(false);
    }
  }, [browseState, onSelect, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[80vh] flex-col gap-3 p-4 sm:max-w-lg"
      >
        {browseState && (
          <PathBreadcrumbs path={browseState.currentPath} onNavigate={handleNavigate} />
        )}

        <ScrollArea className="h-80 rounded-md border">
          <div className="p-1">
            {loading && !browseState ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
                <AlertCircle className="h-5 w-5" />
                {error}
              </div>
            ) : browseState ? (
              <>
                {browseState.parentPath && (
                  <DirectoryRow
                    kind="parent"
                    label=".."
                    onClick={() => handleNavigate(browseState.parentPath!)}
                    disabled={loading}
                  />
                )}
                {browseState.directories.map((dir) => (
                  <DirectoryRow
                    key={dir.path}
                    kind="directory"
                    label={dir.name}
                    onClick={() => handleNavigate(dir.path)}
                    disabled={loading}
                  />
                ))}
                {browseState.directories.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    No subdirectories
                  </div>
                )}
              </>
            ) : null}
          </div>
        </ScrollArea>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs text-muted-foreground"
            onClick={handleShowHiddenToggle}
          >
            {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
            {showHidden ? "Hide" : "Show"} hidden
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!browseState || loading} onClick={handleSelect}>
              {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Select
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type BrowseState = {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
};

type DirectoryBrowserState = {
  browseState: BrowseState | null;
  loading: boolean;
  error: string | null;
  showHidden: boolean;
  activeRequestId: number;
};

type DirectoryBrowserAction =
  | { type: "navigationStarted"; requestId: number; clearBrowseState?: boolean }
  | { type: "navigationSucceeded"; requestId: number; browseState: BrowseState }
  | { type: "navigationFailed"; requestId: number; message: string }
  | { type: "showHiddenChanged"; showHidden: boolean };

const INITIAL_BROWSER_STATE: DirectoryBrowserState = {
  browseState: null,
  loading: false,
  error: null,
  showHidden: false,
  activeRequestId: 0,
};

function directoryBrowserReducer(
  state: DirectoryBrowserState,
  action: DirectoryBrowserAction,
): DirectoryBrowserState {
  switch (action.type) {
    case "navigationStarted":
      return {
        ...state,
        browseState: action.clearBrowseState ? null : state.browseState,
        loading: true,
        error: null,
        activeRequestId: action.requestId,
      };

    case "navigationSucceeded":
      if (action.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        browseState: action.browseState,
        loading: false,
        error: null,
      };

    case "navigationFailed":
      if (action.requestId !== state.activeRequestId) return state;
      return {
        ...state,
        loading: false,
        error: action.message,
      };

    case "showHiddenChanged":
      return {
        ...state,
        showHidden: action.showHidden,
      };
  }
}

type PathBreadcrumbsProps = {
  path: string;
  onNavigate: (path: string) => void;
};

function PathBreadcrumbs({ path, onNavigate }: PathBreadcrumbsProps) {
  const segments = path.split("/").filter(Boolean);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => onNavigate("/")}
        className="shrink-0 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
      >
        /
      </button>
      {segments.map((segment, index) => {
        const segmentPath = "/" + segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;

        return (
          <span key={segmentPath} className="flex items-center gap-0.5">
            <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
            {isLast ? (
              <span className="truncate rounded px-1 py-0.5 font-medium text-foreground">
                {segment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(segmentPath)}
                className="truncate rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
              >
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}

type DirectoryRowProps = {
  kind: "parent" | "directory";
  label: string;
  disabled: boolean;
  onClick: () => void;
};

function DirectoryRow({ kind, label, disabled, onClick }: DirectoryRowProps) {
  const Icon = kind === "parent" ? FolderUp : FolderClosed;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
        "hover:bg-accent hover:text-accent-foreground",
        "disabled:pointer-events-none disabled:opacity-50",
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className={cn("truncate", kind === "parent" && "text-muted-foreground")}>{label}</span>
    </button>
  );
}
