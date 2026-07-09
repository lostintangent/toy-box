import { useAtom } from "jotai";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  autoFocusArtifactsAtom,
  isSessionFeatureScope,
  terminalShellAtom,
  worktreeAtom,
} from "@/lib/config/settings";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [terminalShell, setTerminalShell] = useAtom(terminalShellAtom);
  const [useWorktree, setUseWorktree] = useAtom(worktreeAtom);
  const [autoFocusArtifacts, setAutoFocusArtifacts] = useAtom(autoFocusArtifactsAtom);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <label htmlFor="auto-focus-artifacts" className="text-sm font-medium text-foreground">
              Auto-focus artifacts
            </label>
            <Select
              value={autoFocusArtifacts}
              onValueChange={(value) => {
                if (isSessionFeatureScope(value)) setAutoFocusArtifacts(value);
              }}
            >
              <SelectTrigger id="auto-focus-artifacts" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Always</SelectItem>
                <SelectItem value="sessions">Sessions</SelectItem>
                <SelectItem value="automations">Automations</SelectItem>
                <SelectItem value="never">Never</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <label htmlFor="terminal-shell" className="text-sm font-medium text-foreground">
              Terminal shell
            </label>
            <Input
              key={terminalShell}
              id="terminal-shell"
              defaultValue={terminalShell}
              onBlur={(event) => {
                const value = event.currentTarget.value.trim();
                event.currentTarget.value = value;
                setTerminalShell(value);
              }}
              placeholder="/bin/zsh or zsh"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              Provide a full path or a binary on your PATH. Close and reopen the terminal to apply.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="use-worktree"
              checked={useWorktree}
              onCheckedChange={(checked) => {
                setUseWorktree(checked === true);
              }}
            />
            <label htmlFor="use-worktree" className="text-sm font-medium text-foreground">
              Start new sessions in a worktree
            </label>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
