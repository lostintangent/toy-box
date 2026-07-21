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
import { isAccentColor, isSessionFeatureScope } from "@/lib/workspace/config/settings";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@/hooks/workspace/state";

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useWorkspaceSelector((workspace) => workspace.settings);
  const updateSetting = useUpdateWorkspaceSetting();
  const { accentColor, terminalShell, useWorktree, autoFocusArtifacts } = settings;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_8rem] gap-x-4 gap-y-2">
            <label htmlFor="auto-focus-artifacts" className="text-sm font-medium text-foreground">
              Auto-focus artifacts
            </label>
            <label htmlFor="accent-color" className="text-sm font-medium text-foreground">
              Accent color
            </label>
            <Select
              value={autoFocusArtifacts}
              onValueChange={(value) => {
                if (isSessionFeatureScope(value)) {
                  updateSetting("autoFocusArtifacts", value);
                }
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
            <div className="relative flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
              <span
                aria-hidden="true"
                className="size-4 shrink-0 rounded-full border border-black/10 bg-user-accent"
              />
              <code className="text-xs text-muted-foreground uppercase">{accentColor}</code>
              <input
                id="accent-color"
                type="color"
                value={accentColor}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  if (isAccentColor(value)) updateSetting("accentColor", value);
                }}
                className="absolute inset-0 size-full cursor-pointer opacity-0"
              />
            </div>
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
                updateSetting("terminalShell", value);
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
                updateSetting("useWorktree", checked === true);
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
