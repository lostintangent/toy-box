import { createContext, useContext, useState, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronRight,
  Eye,
  EyeOff,
  File as FileIcon,
  FolderClosed,
  FolderUp,
  Loader2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { listDirectory, type DirectoryEntry, type DirectoryListing } from "@/functions/fs";
import { cn } from "@/lib/utils";
import { PathBreadcrumbs } from "./PathBreadcrumbs";

/**
 * Browse the host filesystem as an expandable tree. Pass `onOpenFile` to open files
 * (a file browser) or `onSelectDirectory` to choose a directory (a directory picker).
 * The completion handler is the only thing that changes: directories always expand
 * via their chevron; files appear only when they can be opened.
 */
export function FileBrowserDialog({
  open,
  onOpenChange,
  title,
  initialPath,
  onOpenFile,
  onSelectDirectory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialPath?: string;
  onOpenFile?: (path: string) => void;
  onSelectDirectory?: (path: string) => void;
}) {
  const complete = (handler: (path: string) => void) => (path: string) => {
    handler(path);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[80vh] flex-col gap-3 p-4 sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <FileBrowser
          initialPath={initialPath}
          onCancel={() => onOpenChange(false)}
          onOpenFile={onOpenFile && complete(onOpenFile)}
          onSelectDirectory={onSelectDirectory && complete(onSelectDirectory)}
        />
      </DialogContent>
    </Dialog>
  );
}

// Config shared by every node in the tree, so the recursion stays prop-light.
type TreeContextValue = {
  showHidden: boolean;
  onOpenFile?: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
};

const TreeContext = createContext<TreeContextValue | null>(null);
const useTree = () => {
  const value = useContext(TreeContext);
  if (!value) throw new Error("File tree nodes must render inside a FileBrowser.");
  return value;
};

function FileBrowser({
  initialPath,
  onCancel,
  onOpenFile,
  onSelectDirectory,
}: {
  initialPath?: string;
  onCancel: () => void;
  onOpenFile?: (path: string) => void;
  onSelectDirectory?: (path: string) => void;
}) {
  const [root, setRoot] = useState(initialPath);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedPath, setSelectedPath] = useState<string | undefined>(undefined);
  const {
    data: listing,
    error,
    isPending,
  } = useQuery({
    queryKey: ["filesystem", "browse", root ?? null, showHidden],
    queryFn: () => listDirectory({ data: { path: root, showHidden } }),
    placeholderData: keepPreviousData,
    retry: false,
  });

  const errorMessage = error ? "Failed to load directory contents." : undefined;

  // A directory choice defaults to the current folder (the long-standing "Select
  // this folder" behavior) and narrows as the user clicks into the tree.
  const chosenPath = selectedPath ?? listing?.currentPath;

  function navigate(path: string) {
    setSelectedPath(undefined);
    setRoot(path);
  }

  const context: TreeContextValue = {
    showHidden,
    onOpenFile,
    selectedPath: onSelectDirectory ? chosenPath : undefined,
    onSelect: onSelectDirectory ? setSelectedPath : undefined,
  };
  const isEmpty =
    !!listing && listing.directories.length === 0 && (!onOpenFile || listing.files.length === 0);

  return (
    <TreeContext.Provider value={context}>
      {listing && <PathBreadcrumbs path={listing.currentPath} onNavigate={navigate} />}
      <ScrollArea className="h-96 rounded-md border">
        <div className="p-1">
          {isPending ? (
            <Centered>
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </Centered>
          ) : errorMessage ? (
            <Centered>
              <AlertCircle className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">{errorMessage}</span>
            </Centered>
          ) : listing ? (
            <>
              {listing.parentPath && (
                <Row
                  depth={0}
                  icon={FolderUp}
                  label=".."
                  muted
                  onActivate={() => navigate(listing.parentPath!)}
                />
              )}
              <DirectoryChildren listing={listing} depth={0} />
              {isEmpty && (
                <div className="py-8 text-center text-sm text-muted-foreground">Empty folder</div>
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
          {onSelectDirectory && (
            <Button
              size="sm"
              disabled={!chosenPath}
              onClick={() => chosenPath && onSelectDirectory(chosenPath)}
            >
              Select
            </Button>
          )}
        </div>
      </DialogFooter>
    </TreeContext.Provider>
  );
}

function DirectoryChildren({ listing, depth }: { listing: DirectoryListing; depth: number }) {
  const { onOpenFile } = useTree();

  return (
    <>
      {listing.directories.map((directory) => (
        <DirectoryNode key={directory.path} entry={directory} depth={depth} />
      ))}
      {onOpenFile &&
        listing.files.map((file) => (
          <Row
            key={file.path}
            depth={depth}
            icon={FileIcon}
            label={file.name}
            onActivate={() => onOpenFile(file.path)}
          />
        ))}
    </>
  );
}

function DirectoryNode({ entry, depth }: { entry: DirectoryEntry; depth: number }) {
  const { showHidden, onSelect, selectedPath } = useTree();
  const [expanded, setExpanded] = useState(false);
  const { data: listing, isPending } = useQuery({
    queryKey: ["filesystem", "browse", entry.path, showHidden],
    queryFn: () => listDirectory({ data: { path: entry.path, showHidden } }),
    enabled: expanded,
    retry: false,
  });
  const toggle = () => setExpanded((current) => !current);

  return (
    <>
      <Row
        depth={depth}
        icon={FolderClosed}
        label={entry.name}
        expanded={expanded}
        onToggle={toggle}
        // Picker: activating a folder selects it and reveals its contents; browser: it expands.
        onActivate={
          onSelect
            ? () => {
                onSelect(entry.path);
                setExpanded(true);
              }
            : toggle
        }
        selected={selectedPath === entry.path}
      />
      {expanded &&
        (isPending ? (
          <Row depth={depth + 1} icon={Loader2} label="Loading…" muted spin />
        ) : listing ? (
          <DirectoryChildren listing={listing} depth={depth + 1} />
        ) : (
          <Row depth={depth + 1} icon={AlertCircle} label="Unable to read" muted />
        ))}
    </>
  );
}

function Row({
  depth,
  icon: Icon,
  label,
  onActivate,
  onToggle,
  expanded,
  selected,
  muted,
  spin,
}: {
  depth: number;
  icon: LucideIcon;
  label: string;
  onActivate?: () => void;
  onToggle?: () => void;
  expanded?: boolean;
  selected?: boolean;
  muted?: boolean;
  spin?: boolean;
}) {
  return (
    <div
      style={{ paddingLeft: depth * 14 + 8 }}
      className={cn(
        "flex items-center gap-1 rounded-sm pr-2 text-sm",
        selected && "bg-accent text-accent-foreground",
      )}
    >
      {onToggle ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          className="shrink-0 rounded p-0.5 hover:bg-accent"
        >
          <ChevronRight
            className={cn(
              "h-3.5 w-3.5 text-muted-foreground transition-transform",
              expanded && "rotate-90",
            )}
          />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <button
        type="button"
        onClick={onActivate}
        disabled={!onActivate}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left",
          onActivate ? "hover:text-accent-foreground" : "pointer-events-none",
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0 text-muted-foreground", spin && "animate-spin")} />
        <span className={cn("truncate", muted && "text-muted-foreground")}>{label}</span>
      </button>
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center justify-center gap-2 py-12">{children}</div>;
}
