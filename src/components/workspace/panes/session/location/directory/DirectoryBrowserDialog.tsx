import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
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
import { listDirectory, type ListDirectoryResult } from "@/functions/fs";
import { cn } from "@/lib/utils";

export function DirectoryBrowserDialog({
  open,
  onOpenChange,
  onSelect,
  initialPath,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (directory: string) => void;
  initialPath?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[80vh] flex-col gap-3 p-4 sm:max-w-lg"
      >
        <DirectoryBrowser
          initialPath={initialPath}
          onCancel={() => onOpenChange(false)}
          onSelect={(directory) => {
            onSelect(directory);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function DirectoryBrowser({
  initialPath,
  onCancel,
  onSelect,
}: {
  initialPath?: string;
  onCancel: () => void;
  onSelect: (directory: string) => void;
}) {
  const [path, setPath] = useState(initialPath);
  const [showHidden, setShowHidden] = useState(false);
  const { data, error, isPending, isFetching } = useQuery({
    queryKey: ["filesystem", "directories", path ?? null, showHidden],
    queryFn: () => listDirectory({ data: { path, showHidden } }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const listing: Extract<ListDirectoryResult, { status: "ok" }> | undefined =
    data?.status === "ok" ? data : undefined;
  const errorMessage =
    data?.status === "error"
      ? data.message
      : error
        ? "Failed to load directory contents."
        : undefined;
  const loading = isPending || isFetching;

  return (
    <>
      {listing && <PathBreadcrumbs path={listing.currentPath} onNavigate={setPath} />}

      <ScrollArea className="h-80 rounded-md border">
        <div className="p-1">
          {loading && !listing ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : errorMessage ? (
            <div className="flex flex-col items-center gap-2 py-12 text-center text-sm text-muted-foreground">
              <AlertCircle className="h-5 w-5" />
              {errorMessage}
            </div>
          ) : listing ? (
            <>
              {listing.parentPath && (
                <DirectoryRow
                  kind="parent"
                  label=".."
                  onClick={() => setPath(listing.parentPath!)}
                  disabled={loading}
                />
              )}
              {listing.directories.map((directory) => (
                <DirectoryRow
                  key={directory.path}
                  kind="directory"
                  label={directory.name}
                  onClick={() => setPath(directory.path)}
                  disabled={loading}
                />
              ))}
              {listing.directories.length === 0 && (
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
          onClick={() => setShowHidden((current) => !current)}
        >
          {showHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
          {showHidden ? "Hide" : "Show"} hidden
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!listing || loading}
            onClick={() => listing && onSelect(listing.currentPath)}
          >
            {loading && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Select
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

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

function DirectoryRow({
  kind,
  label,
  disabled,
  onClick,
}: {
  kind: "parent" | "directory";
  label: string;
  disabled: boolean;
  onClick: () => void;
}) {
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
