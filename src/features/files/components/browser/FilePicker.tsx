import { useState } from "react";
import { File } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import { machineFile, type WorkspaceFile } from "../../model";
import { fileName, getPathDirname } from "../../model/paths";
import { FileBrowserDialog } from "./FileBrowserDialog";

type MachineFile = Extract<WorkspaceFile, { type: "machine" }>;

type FilePickerProps = {
  value?: MachineFile | null;
  onValueChange: (value: MachineFile) => void;
  extensions?: readonly string[];
  className?: string;
};

/** Select or create a machine file through the shared filesystem browser. */
export function FilePicker({ value, onValueChange, extensions, className }: FilePickerProps) {
  const [open, setOpen] = useState(false);
  const label = value ? fileName(value.path) : "Choose file";

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={cn("h-8 max-w-full gap-1.5", className)}
        aria-label={
          value ? `Choose a different file. Current file: ${value.path}` : "Choose a file"
        }
        onClick={() => setOpen(true)}
      >
        <File className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </Button>

      <FileBrowserDialog
        open={open}
        onOpenChange={setOpen}
        title="Select a file"
        initialPath={value ? getPathDirname(value.path) : undefined}
        extensions={extensions}
        onOpenFile={(path) => onValueChange(machineFile(path))}
      />
    </>
  );
}
