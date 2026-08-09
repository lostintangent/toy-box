import {
  createContext,
  useContext,
  useState,
  type Dispatch,
  type FormEvent,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronRight,
  Eye,
  EyeOff,
  File as FileIcon,
  FolderClosed,
  FolderUp,
  Loader2,
  Plus,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/components/ui/dialog";
import { ScrollArea } from "@/shared/components/ui/scroll-area";
import { cn } from "@/shared/utils";
import { fileMutations } from "../../mutations";
import type { DirectoryEntry, DirectoryListing } from "../../model";
import { fileQueries } from "../../queries";
import { PathBreadcrumbs } from "./PathBreadcrumbs";

/**
 * Browse the host filesystem as an expandable tree. Pass `onOpenFile` to open files
 * (a file browser) or `onSelectDirectory` to choose a directory (a directory picker).
 * File browsers can also create a file and return it through the same completion
 * handler. Directories always expand via their chevron; files appear only when they
 * can be opened.
 */
export function FileBrowserDialog({
  open,
  onOpenChange,
  title,
  initialPath,
  extensions,
  onOpenFile,
  onSelectDirectory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  initialPath?: string;
  extensions?: readonly string[];
  onOpenFile?: (path: string) => void;
  onSelectDirectory?: (path: string) => void;
}) {
  const [creatingFileIn, setCreatingFileIn] = useState<string | undefined>(undefined);

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) setCreatingFileIn(undefined);
    onOpenChange(nextOpen);
  };
  const complete = (handler: (path: string) => void) => (path: string) => {
    handler(path);
    changeOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[80vh] flex-col gap-3 p-4 sm:max-w-lg"
        onEscapeKeyDown={(event) => {
          if (!creatingFileIn) return;
          event.preventDefault();
          setCreatingFileIn(undefined);
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>
        <FileBrowser
          initialPath={initialPath}
          extensions={extensions}
          creatingFileIn={creatingFileIn}
          setCreatingFileIn={setCreatingFileIn}
          onCancel={() => changeOpen(false)}
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
  extensions?: readonly string[];
  onOpenFile?: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  creatingFileIn?: string;
  onStartFileCreation?: (directory: string) => void;
  onCancelFileCreation?: (directory: string) => void;
};

const TreeContext = createContext<TreeContextValue | null>(null);
const useTree = () => {
  const value = useContext(TreeContext);
  if (!value) throw new Error("File tree nodes must render inside a FileBrowser.");
  return value;
};

function FileBrowser({
  initialPath,
  extensions,
  creatingFileIn,
  setCreatingFileIn,
  onCancel,
  onOpenFile,
  onSelectDirectory,
}: {
  initialPath?: string;
  extensions?: readonly string[];
  creatingFileIn?: string;
  setCreatingFileIn: Dispatch<SetStateAction<string | undefined>>;
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
    isPlaceholderData,
  } = useQuery(fileQueries.browse(root, showHidden));

  const errorMessage = error ? "Failed to load directory contents." : undefined;

  // A directory choice defaults to the current folder (the long-standing "Select
  // this folder" behavior) and narrows as the user clicks into the tree.
  const chosenPath = isPlaceholderData ? undefined : (selectedPath ?? listing?.currentPath);

  function navigate(path: string) {
    setSelectedPath(undefined);
    setCreatingFileIn(undefined);
    setRoot(path);
  }

  function cancelFileCreation(directory: string) {
    setCreatingFileIn((current) => (current === directory ? undefined : current));
  }

  const context: TreeContextValue = {
    showHidden,
    extensions: onOpenFile ? extensions : undefined,
    onOpenFile,
    selectedPath: onSelectDirectory ? chosenPath : undefined,
    onSelect: onSelectDirectory ? setSelectedPath : undefined,
    creatingFileIn,
    onStartFileCreation: onOpenFile ? setCreatingFileIn : undefined,
    onCancelFileCreation: onOpenFile ? cancelFileCreation : undefined,
  };
  const isEmpty =
    !!listing &&
    listing.directories.length === 0 &&
    (!onOpenFile || listing.files.every((file) => !acceptsExtension(file.path, extensions))) &&
    creatingFileIn !== listing.currentPath;

  return (
    <TreeContext.Provider value={context}>
      {listing && (
        <div className="flex min-w-0 items-center gap-1">
          <PathBreadcrumbs path={listing.currentPath} onNavigate={navigate} />
          <div className="ml-auto flex items-center gap-1">
            {isPlaceholderData && (
              <Loader2
                aria-label="Loading directory"
                className="size-3.5 animate-spin text-muted-foreground"
              />
            )}
            {onOpenFile && (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                disabled={isPlaceholderData}
                aria-label={`Create a file in ${listing.currentPath}`}
                title="New file here"
                onClick={() => setCreatingFileIn(listing.currentPath)}
              >
                <Plus />
              </Button>
            )}
          </div>
        </div>
      )}
      <ScrollArea className="h-96 min-h-0 rounded-md border">
        <div className="p-1" aria-busy={isPlaceholderData} inert={isPlaceholderData}>
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
              {creatingFileIn === listing.currentPath && onOpenFile && (
                <NewFileRow
                  directory={listing.currentPath}
                  depth={0}
                  onCancel={() => cancelFileCreation(listing.currentPath)}
                  onCreated={onOpenFile}
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
              disabled={!chosenPath || isPlaceholderData}
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
  const { extensions, onOpenFile } = useTree();

  return (
    <>
      {listing.directories.map((directory) => (
        <DirectoryNode key={directory.path} entry={directory} depth={depth} />
      ))}
      {onOpenFile &&
        listing.files
          .filter((file) => acceptsExtension(file.path, extensions))
          .map((file) => (
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
  const {
    showHidden,
    onOpenFile,
    onSelect,
    selectedPath,
    creatingFileIn,
    onStartFileCreation,
    onCancelFileCreation,
  } = useTree();
  const [expanded, setExpanded] = useState(false);
  const { data: listing, isPending } = useQuery({
    ...fileQueries.browse(entry.path, showHidden),
    enabled: expanded,
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
        onCreateFile={
          onStartFileCreation
            ? () => {
                setExpanded(true);
                onStartFileCreation(entry.path);
              }
            : undefined
        }
        selected={selectedPath === entry.path}
      />
      {expanded && (
        <>
          {creatingFileIn === entry.path && onOpenFile && (
            <NewFileRow
              directory={entry.path}
              depth={depth + 1}
              onCancel={() => onCancelFileCreation?.(entry.path)}
              onCreated={onOpenFile}
            />
          )}
          {isPending ? (
            <Row depth={depth + 1} icon={Loader2} label="Loading…" muted spin />
          ) : listing ? (
            <DirectoryChildren listing={listing} depth={depth + 1} />
          ) : (
            <Row depth={depth + 1} icon={AlertCircle} label="Unable to read" muted />
          )}
        </>
      )}
    </>
  );
}

function NewFileRow({
  directory,
  depth,
  onCancel,
  onCreated,
}: {
  directory: string;
  depth: number;
  onCancel: () => void;
  onCreated: (path: string) => void;
}) {
  const { extensions } = useTree();
  const [name, setName] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const createMutation = useMutation(fileMutations.create());
  const error = validationError ?? (createMutation.isError ? createMutation.error.message : null);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || createMutation.isPending) return;
    if (extensions?.length && !acceptsExtension(trimmedName, extensions)) {
      setValidationError(`File name must end in ${extensions.join(" or ")}.`);
      return;
    }

    setValidationError(null);
    createMutation.mutate(
      { directory, name: trimmedName },
      { onSuccess: ({ path }) => onCreated(path) },
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ paddingLeft: depth * 14 + 28 }} className="py-1 pr-2">
      <div className="flex items-center gap-1.5">
        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
        <Input
          autoFocus
          value={name}
          readOnly={createMutation.isPending}
          aria-label={`New file name in ${directory}`}
          aria-invalid={!!error}
          aria-disabled={createMutation.isPending}
          placeholder="File name"
          className="h-7 px-2 text-xs"
          onBlur={() => {
            if (!createMutation.isPending) setTimeout(onCancel);
          }}
          onChange={(event) => {
            setName(event.target.value);
            setValidationError(null);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (!createMutation.isPending) onCancel();
          }}
        />
        {createMutation.isPending && (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>
      {error && (
        <p role="alert" className="pt-1 pl-5.5 text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}

function acceptsExtension(path: string, extensions?: readonly string[]): boolean {
  if (!extensions?.length) return true;
  const normalizedPath = path.toLowerCase();
  return extensions.some((extension) => normalizedPath.endsWith(extension.toLowerCase()));
}

function Row({
  depth,
  icon: Icon,
  label,
  onActivate,
  onToggle,
  expanded,
  selected,
  onCreateFile,
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
  onCreateFile?: () => void;
  muted?: boolean;
  spin?: boolean;
}) {
  return (
    <div
      style={{ paddingLeft: depth * 14 + 8 }}
      className={cn(
        "group flex items-center gap-1 rounded-sm pr-2 text-sm",
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
      {onCreateFile && (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="opacity-50 transition-opacity hover:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
          aria-label={`Create a file in ${label}`}
          title={`New file in ${label}`}
          onClick={onCreateFile}
        >
          <Plus />
        </Button>
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex flex-col items-center justify-center gap-2 py-12">{children}</div>;
}
