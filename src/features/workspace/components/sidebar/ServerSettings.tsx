import { useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, RotateCcw, Server } from "lucide-react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { CollapsibleSection } from "@/shared/ui/section-heading";
import { isHexColor } from "@/shared/utils";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "../../hooks/state";
import { workspaceMutations } from "../../mutations";
import { workspaceQueries } from "../../queries";
import { SettingField } from "./SettingField";

/** This server's name, accent color and release: renaming and recoloring it, installing the newest
 *  release, and restarting into it. */
export function ServerSettings() {
  const serverName = useWorkspaceSelector((workspace) => workspace.settings.serverName);
  const accentColor = useWorkspaceSelector((workspace) => workspace.settings.accentColor);
  const computerName = useWorkspaceSelector((workspace) => workspace.environment.computerName);
  const updateSetting = useUpdateWorkspaceSetting();
  const { data: server } = useQuery(workspaceQueries.server);
  const { mutate: update } = useMutation(workspaceMutations.updateServer());
  const { mutate: restart } = useMutation(workspaceMutations.restartServer());

  // Each request's latest state comes from the query client, so reopening Settings still shows it.
  const updateState = useMutationState({
    filters: { mutationKey: workspaceMutations.updateServer().mutationKey },
  }).at(-1);
  const restartState = useMutationState({
    filters: { mutationKey: workspaceMutations.restartServer().mutationKey },
  }).at(-1);
  const isUpdating = updateState?.status === "pending";
  // A restart ends when the workspace stream reconnects to the new release and reloads this tab.
  const isRestarting = restartState?.status === "pending" || restartState?.status === "success";

  // No installed release means no package manager owns this run, as in `bun dev`.
  const installedVersion = server?.installedVersion;
  const hasPendingRestart = installedVersion != null && installedVersion !== server?.version;
  const error = (updateState?.error ?? restartState?.error)?.message.split("\n")[0];

  return (
    <CollapsibleSection
      title="Server Details"
      icon={Server}
      badge={server?.version}
      detail={
        hasPendingRestart ? (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={isRestarting}
            onClick={() => restart()}
          >
            {isRestarting ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            {isRestarting ? "Restarting…" : `Restart (${installedVersion})`}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="xs"
            disabled={!installedVersion || isUpdating}
            onClick={() => update()}
          >
            {isUpdating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Update
          </Button>
        )
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <SettingField label="Name" htmlFor="server-name">
          <Input
            key={serverName}
            id="server-name"
            defaultValue={serverName}
            onBlur={(event) => {
              const value = event.currentTarget.value.trim();
              event.currentTarget.value = value;
              updateSetting("serverName", value);
            }}
            placeholder={computerName}
            maxLength={64}
            spellCheck={false}
          />
        </SettingField>
        <SettingField label="Accent color" htmlFor="accent-color">
          <div className="relative flex h-9 items-center gap-2 rounded-md border border-input bg-transparent px-3 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            <span
              aria-hidden="true"
              className="size-4 shrink-0 rounded-full border border-black/10 bg-accent"
            />
            <code className="text-xs text-muted-foreground uppercase">{accentColor}</code>
            <input
              id="accent-color"
              type="color"
              value={accentColor}
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isHexColor(value)) updateSetting("accentColor", value);
              }}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </div>
        </SettingField>
      </div>
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </CollapsibleSection>
  );
}
