import { useCallback, useEffect, useState } from "react";
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
import { listDirectoryContents, type DirectoryEntry } from "@/functions/fs";
import { cn } from "@/lib/utils";

type DirectoryBrowserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (directory: string) => void;
  initialPath?: string;
};

type BrowseState = {
  currentPath: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
};

function PathBreadcrumbs({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
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

export function DirectoryBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  initialPath,
}: DirectoryBrowserDialogProps) {
  const [browseState, setBrowseState] = useState<BrowseState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const navigateTo = useCallback(
    async (path?: string) => {
      setLoading(true);
      setError(null);

      try {
        const result = await listDirectoryContents({
          data: { path, showHidden },
        });
        if (result.status === "ok") {
          setBrowseState({
            currentPath: result.currentPath,
            parentPath: result.parentPath,
            directories: result.directories,
          });
        } else {
          setError(result.message);
        }
      } catch {
        setError("Failed to load directory contents.");
      } finally {
        setLoading(false);
      }
    },
    [showHidden],
  );

  useEffect(() => {
    if (!open) return;
    setBrowseState(null);
    setError(null);
    void navigateTo(initialPath);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open || !browseState) return;
    void navigateTo(browseState.currentPath);
  }, [showHidden]); // eslint-disable-line react-hooks/exhaustive-deps

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
        {browseState && <PathBreadcrumbs path={browseState.currentPath} onNavigate={navigateTo} />}

        <ScrollArea className="h-[320px] rounded-md border">
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
                  <button
                    type="button"
                    onClick={() => navigateTo(browseState.parentPath!)}
                    disabled={loading}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                      "hover:bg-accent hover:text-accent-foreground",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    <FolderUp className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="text-muted-foreground">..</span>
                  </button>
                )}
                {browseState.directories.map((dir) => (
                  <button
                    key={dir.path}
                    type="button"
                    onClick={() => navigateTo(dir.path)}
                    disabled={loading}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm",
                      "hover:bg-accent hover:text-accent-foreground",
                      "disabled:pointer-events-none disabled:opacity-50",
                    )}
                  >
                    <FolderClosed className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{dir.name}</span>
                  </button>
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
            onClick={() => setShowHidden((prev) => !prev)}
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
