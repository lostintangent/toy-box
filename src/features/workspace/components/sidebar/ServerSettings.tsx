import { useMutation, useMutationState, useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, RefreshCw, RotateCcw, Server } from "lucide-react";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Input } from "@/shared/ui/input";
import { CollapsibleSection } from "@/shared/ui/section-heading";
import { cn, isHexColor } from "@/shared/utils";
import { version } from "../../../../../package.json";
import { useUpdateWorkspaceSetting, useWorkspaceSelector } from "../../hooks/state";
import { isRestartPending } from "../../model/server";
import { workspaceMutations } from "../../mutations";
import { workspaceQueries } from "../../queries";
import { SettingField } from "./SettingField";

/** This server's name, accent color and release, and its peer servers': renaming and recoloring
 *  it, installing the newest release on every server, and restarting the ones with a pending
 *  restart, or else this one onto the same release. */
export function ServerSettings() {
  const serverName = useWorkspaceSelector((workspace) => workspace.settings.serverName);
  const accentColor = useWorkspaceSelector((workspace) => workspace.settings.accentColor);
  const computerName = useWorkspaceSelector((workspace) => workspace.environment.computerName);
  // No installed release means no package manager owns this run, as in `bun dev`.
  const installedVersion = useWorkspaceSelector((workspace) => workspace.installedVersion);
  // Read as Settings opens, since the collapsed heading's actions cover the peers too.
  const { data: peers = [] } = useQuery(workspaceQueries.peerServers);
  const updateSetting = useUpdateWorkspaceSetting();
  const { mutate: update } = useMutation(workspaceMutations.updateServers());
  const { mutate: restart } = useMutation(workspaceMutations.restartServers());

  // Each request's latest state comes from the query client, so reopening Settings still shows it.
  const updateState = useMutationState({
    filters: { mutationKey: workspaceMutations.updateServers().mutationKey },
  }).at(-1);
  const restartState = useMutationState({
    filters: { mutationKey: workspaceMutations.restartServers().mutationKey },
  }).at(-1);
  const isUpdating = updateState?.status === "pending";
  // A restart answers with the release it restarts into. When that's another one, the restart ends
  // as the workspace stream reconnects to it and reloads this tab.
  const isRestarting =
    restartState?.status === "pending" ||
    (restartState?.status === "success" && restartState.data !== version);
  const error = (updateState?.error ?? restartState?.error)?.message.split("\n")[0];

  const servers = [{ version, installedVersion }, ...peers];
  const pending = servers.filter(isRestartPending);
  const hasPendingRestart = pending.length > 0;

  // A pending restart leads, and Update stays in the menu to check for an even newer release.
  // Otherwise Update leads, and Restart relaunches only this server, which a dev server can't.
  const updateAction = { icon: RefreshCw, label: "Update", run: () => update() };
  const restartAction = {
    icon: RotateCcw,
    label: hasPendingRestart ? `Restart (${pending[0].installedVersion})` : "Restart",
    run: () => restart(),
  };
  const primary = hasPendingRestart ? restartAction : updateAction;
  const secondary = hasPendingRestart ? updateAction : installedVersion && restartAction;

  return (
    <CollapsibleSection
      title="Server Details"
      icon={Server}
      badge={version}
      defaultOpen={false}
      detail={
        !servers.some((server) => server.installedVersion) || isUpdating || isRestarting ? (
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
              className={cn(secondary && "rounded-r-none")}
              onClick={primary.run}
            >
              <primary.icon />
              {primary.label}
            </Button>
            {secondary && (
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
            )}
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
      {peers.length > 0 && (
        <div className="mt-4 grid gap-3">
          {peers.map((peer) => (
            <div key={peer.origin} className="grid min-w-0">
              <div className="flex h-5 items-center gap-2 text-sm">
                <span className="truncate">{peer.name}</span>
                <Badge variant="count">
                  {isRestartPending(peer)
                    ? `${peer.version} → ${peer.installedVersion}`
                    : peer.version}
                </Badge>
              </div>
              <a
                href={peer.origin}
                target="_blank"
                rel="noreferrer"
                className="w-fit max-w-full truncate text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {peer.origin}
              </a>
            </div>
          ))}
        </div>
      )}
      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}
    </CollapsibleSection>
  );
}
