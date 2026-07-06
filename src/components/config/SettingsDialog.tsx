import { useEffect, useState } from "react";
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
  getSettings,
  isSessionFeatureScope,
  updateSetting,
  type SessionFeatureScope,
} from "@/lib/config/settings";

const SESSION_FEATURE_SCOPE_OPTIONS = [
  { value: "always", label: "Always" },
  { value: "sessions", label: "Sessions" },
  { value: "automations", label: "Automations" },
  { value: "never", label: "Never" },
] satisfies { value: SessionFeatureScope; label: string }[];

type FeatureScopeSettingProps = {
  id: string;
  label: string;
  value: SessionFeatureScope;
  onValueChange: (value: SessionFeatureScope) => void;
};

function FeatureScopeSetting({ id, label, value, onValueChange }: FeatureScopeSettingProps) {
  return (
    <div className="grid min-w-0 gap-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <Select
        value={value}
        onValueChange={(nextValue) => {
          if (!isSessionFeatureScope(nextValue)) return;
          onValueChange(nextValue);
        }}
      >
        <SelectTrigger id={id} className="w-full min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SESSION_FEATURE_SCOPE_OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export type SettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const [shell, setShell] = useState("");
  const [useWorktree, setUseWorktree] = useState(false);
  const [autoFocusArtifacts, setAutoFocusArtifacts] = useState<SessionFeatureScope>("automations");
  const [showSessionOverlay, setShowSessionOverlay] = useState<SessionFeatureScope>("sessions");

  useEffect(() => {
    if (!open) return;
    const settings = getSettings();
    setShell(settings.terminalShell);
    setUseWorktree(settings.useWorktree);
    setShowSessionOverlay(settings.showSessionOverlay);
    setAutoFocusArtifacts(settings.autoFocusArtifacts);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <FeatureScopeSetting
              id="auto-focus-artifacts"
              label="Auto-focus artifacts"
              value={autoFocusArtifacts}
              onValueChange={(nextValue) => {
                setAutoFocusArtifacts(nextValue);
                updateSetting("autoFocusArtifacts", nextValue);
              }}
            />
            <FeatureScopeSetting
              id="show-session-overlay"
              label="Session overlay"
              value={showSessionOverlay}
              onValueChange={(nextValue) => {
                setShowSessionOverlay(nextValue);
                updateSetting("showSessionOverlay", nextValue);
              }}
            />
          </div>
          <div className="grid gap-2">
            <label htmlFor="terminal-shell" className="text-sm font-medium text-foreground">
              Terminal shell
            </label>
            <Input
              id="terminal-shell"
              value={shell}
              onChange={(event) => setShell(event.target.value)}
              onBlur={() => updateSetting("terminalShell", shell.trim())}
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
                const value = checked === true;
                setUseWorktree(value);
                updateSetting("useWorktree", value);
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
