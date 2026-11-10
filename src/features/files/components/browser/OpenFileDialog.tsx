import { useRevealFile } from "../../useRevealFile";
import { FileBrowserDialog } from "./FileBrowserDialog";

/** Browses the machine from a directory, and reveals the file picked. */
export function OpenFileDialog({
  directory,
  open,
  onOpenChange,
}: {
  directory?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const revealFile = useRevealFile();
  return (
    <FileBrowserDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Open a file"
      initialPath={directory}
      onOpenFile={revealFile}
    />
  );
}
