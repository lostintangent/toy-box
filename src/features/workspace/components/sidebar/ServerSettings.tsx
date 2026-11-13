import { useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, RefreshCw, RotateCcw, Server } from "lucide-react";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { CollapsibleSection } from "@/shared/ui/section-heading";
import { isHexColor } from "@/shared/utils";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "../../hooks/state";
import { workspaceMutations } from "../../mutations";
import { workspaceQueries } from "../../queries";
import { SettingField } from "./SettingField";

/** This server's name, accent color and release: renaming and recoloring it, installing the newest
 *  release, and restarting, into it or onto the same one. */
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
  // A restart answers with the release it restarts into. When that's another one, the restart ends
  // as the workspace stream reconnects to it and reloads this tab.
  const isRestarting =
    restartState?.status === "pending" ||
    (restartState?.status === "success" && restartState.data !== server?.version);

  // No installed release means no package manager owns this run, as in `bun dev`.
  const installedVersion = server?.installedVersion;
  const hasPendingRestart = installedVersion != null && installedVersion !== server?.version;
  const error = (updateState?.error ?? restartState?.error)?.message.split("\n")[0];

  // A pending restart leads, and Update stays in the menu to check for an even newer release.
  const updateAction = { icon: RefreshCw, label: "Update", run: () => update() };
  const restartAction = {
    icon: RotateCcw,
    label: hasPendingRestart ? `Restart (${installedVersion})` : "Restart",
    run: () => restart(),
  };
  const [primary, secondary] = hasPendingRestart
    ? [restartAction, updateAction]
    : [updateAction, restartAction];

  return (
    <CollapsibleSection
      title="Server Details"
      icon={Server}
      badge={server?.version}
      defaultOpen={false}
      detail={
        !installedVersion || isUpdating || isRestarting ? (
          <Button type="button" variant="outline" size="xs" disabled>
            {isUpdating || isRestarting ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            {isRestarting ? "Restarting…" : "Update"}
          </Button>
        ) : (
          <span className="flex">
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="rounded-r-none"
              onClick={primary.run}
            >
              <primary.icon />
              {primary.label}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon-xs"
                    aria-label="More server actions"
                    className="w-5 rounded-l-none border-l-0"
                  />
                }
              >
                <ChevronDown />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={secondary.run}>
                  <secondary.icon />
                  {secondary.label}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
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
