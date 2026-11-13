import { Checkbox } from "@/shared/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
import { Separator } from "@/shared/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "@workspace/hooks/state";
import { ProviderSettings } from "@providers/components/ProviderSettings";
import { LinkedServerSettings } from "./LinkedServerSettings";
import { ServerSettings } from "./ServerSettings";
import { SettingField } from "./SettingField";

const AUTO_FOCUS_ARTIFACT_OPTIONS = {
  always: "Always",
  sessions: "Sessions",
  automations: "Automations",
  never: "Never",
} as const;

const SESSION_VIEW_OPTIONS = {
  all: "All messages",
  responses: "Responses",
} as const;

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useWorkspaceSelector((workspace) => workspace.settings);
  const updateSetting = useUpdateWorkspaceSetting();
  const { terminalShell, useWorktree, autoFocusArtifacts, defaultSessionView } = settings;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(50rem,calc(100vh-2rem))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-4">
            <SettingField label="Default session view" htmlFor="default-session-view">
              <Select
                items={SESSION_VIEW_OPTIONS}
                value={defaultSessionView}
                onValueChange={(value) => updateSetting("defaultSessionView", value)}
              >
                <SelectTrigger id="default-session-view" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(SESSION_VIEW_OPTIONS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingField>
            <SettingField label="Auto-focus artifacts" htmlFor="auto-focus-artifacts">
              <Select
                items={AUTO_FOCUS_ARTIFACT_OPTIONS}
                value={autoFocusArtifacts}
                onValueChange={(value) => updateSetting("autoFocusArtifacts", value)}
              >
                <SelectTrigger id="auto-focus-artifacts" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(AUTO_FOCUS_ARTIFACT_OPTIONS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingField>
            <SettingField label="Terminal shell" htmlFor="terminal-shell">
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
            </SettingField>
            <SettingField label="Start new sessions in a worktree" htmlFor="use-worktree">
              <div className="flex h-9 items-center">
                <Checkbox
                  id="use-worktree"
                  checked={useWorktree}
                  onCheckedChange={(checked) => {
                    updateSetting("useWorktree", checked);
                  }}
                />
              </div>
            </SettingField>
          </div>
          <Separator />
          <ServerSettings />
          <Separator />
          <ProviderSettings />
          <Separator />
          <LinkedServerSettings />
        </div>
      </DialogContent>
    </Dialog>
  );
}
