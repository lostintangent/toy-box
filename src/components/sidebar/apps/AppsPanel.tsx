import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AppWindow, Download, MessageCirclePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { createApp, deleteApp, installApp, uninstallApp, updateApp } from "@/functions/apps";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import { BUILT_IN_APP_DEFINITION_PREFIX, type AppUpdate } from "@/lib/apps/schema";
import { applyWorkspaceEvent } from "@/lib/workspace/state/query";
import type { AppDefinition, AppInstance } from "@/types";
import { Button } from "@/components/ui/button";
import { DestructiveConfirmationDialog } from "@/components/sidebar/shell/DestructiveConfirmationDialog";
import { NameDialog } from "@/components/sidebar/shell/NameDialog";
import { SidebarListItem } from "@/components/sidebar/shell/SidebarListItem";
import { SidebarPanel } from "@/components/sidebar/shell/SidebarPanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { APP_ICONS } from "@/components/workspace/panes/app/runtime/icons";
import { AppColorMenu } from "./AppColorMenu";
import { CreateAppDialog } from "./CreateAppDialog";
import { InstallAppDialog } from "./InstallAppDialog";

export function AppsPanel({
  isExpanded,
  onExpandedChange,
  openAppIds,
  onAppOpen,
  onAppOpenInHyper,
}: {
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  openAppIds: string[];
  onAppOpen: (appId: string, toggleInWorkspace: boolean) => void;
  onAppOpenInHyper: (appId: string) => void;
}) {
  const queryClient = useQueryClient();
  const { apps, definitions } = useWorkspaceSelector((workspace) => ({
    apps: workspace.apps,
    definitions: workspace.appDefinitions,
  }));
  const [createDefinitionId, setCreateDefinitionId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [uninstallDefinitionId, setUninstallDefinitionId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: ({ definitionId, title }: { definitionId: string; title: string }) =>
      createApp({ data: { definitionId, title } }),
    onSuccess: (app) => {
      applyWorkspaceEvent(queryClient, { type: "app.upserted", app });
      setCreateDefinitionId(null);
      onAppOpen(app.id, false);
    },
  });
  const installMutation = useMutation({
    mutationFn: (url: string) => installApp({ data: { url } }),
    onSuccess: ({ definition, app }) => {
      applyWorkspaceEvent(queryClient, { type: "app.registered", definition });
      applyWorkspaceEvent(queryClient, { type: "app.upserted", app });
      setInstallOpen(false);
      onAppOpen(app.id, false);
    },
  });
  const updateMutation = useMutation({
    mutationFn: async ({
      app,
      update,
    }: {
      app: AppInstance;
      update: Omit<AppUpdate, "expectedRevision">;
    }) => {
      let result = await updateApp({
        data: { appId: app.id, expectedRevision: app.revision, ...update },
      });
      if (result.status === "conflict") {
        result = await updateApp({
          data: { appId: app.id, expectedRevision: result.app.revision, ...update },
        });
      }
      return result;
    },
    onSuccess: (result) => {
      applyWorkspaceEvent(queryClient, { type: "app.upserted", app: result.app });
    },
  });
  const uninstallMutation = useMutation({
    mutationFn: (id: string) => uninstallApp({ data: { id } }),
    onSuccess: (_, definitionId) => {
      applyWorkspaceEvent(queryClient, { type: "app.unregistered", definitionId });
      setUninstallDefinitionId(null);
    },
  });
  const deleteMutation = useMutation({
    mutationFn: (appId: string) => deleteApp({ data: { appId } }),
    onSuccess: (_, appId) => {
      applyWorkspaceEvent(queryClient, { type: "app.deleted", appId });
      setDeleteTargetId(null);
    },
  });

  const createDefinition =
    definitions.find((definition) => definition.id === createDefinitionId) ?? null;
  const renameTarget = apps.find((app) => app.id === renameTargetId) ?? null;
  const uninstallDefinition =
    definitions.find((definition) => definition.id === uninstallDefinitionId) ?? null;
  const uninstallInstanceCount = uninstallDefinition
    ? apps.filter((app) => app.definitionId === uninstallDefinition.id).length
    : 0;
  const deleteTarget = apps.find((app) => app.id === deleteTargetId) ?? null;

  return (
    <>
      <SidebarPanel
        title="Apps"
        count={apps.length}
        isExpanded={isExpanded}
        onExpandedChange={onExpandedChange}
        action={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label="Add app"
                title="Add app"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {definitions.map((definition) => (
                <div key={definition.id} className="flex items-center">
                  <DropdownMenuItem
                    className="min-w-0 flex-1"
                    onSelect={() => {
                      createMutation.reset();
                      setCreateDefinitionId(definition.id);
                    }}
                  >
                    <DefinitionIcon definition={definition} />
                    <span className="truncate">{definition.title}</span>
                  </DropdownMenuItem>
                  {!definition.id.startsWith(BUILT_IN_APP_DEFINITION_PREFIX) && (
                    <DropdownMenuItem
                      className="size-8 shrink-0 justify-center p-0 text-muted-foreground focus:text-destructive"
                      aria-label={`Uninstall ${definition.title}`}
                      title={`Uninstall ${definition.title}`}
                      onSelect={() => {
                        uninstallMutation.reset();
                        setUninstallDefinitionId(definition.id);
                      }}
                    >
                      <Trash2 />
                    </DropdownMenuItem>
                  )}
                </div>
              ))}
              {definitions.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem
                onSelect={() => {
                  installMutation.reset();
                  setInstallOpen(true);
                }}
              >
                <Download />
                Install from Gist…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
        {apps.length === 0 ? (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            Saved apps will stay here for quick reopening.
          </p>
        ) : (
          <ul className="space-y-2">
            {apps.map((app) => (
              <li key={app.id}>
                <AppListItem
                  app={app}
                  definition={definitions.find(({ id }) => id === app.definitionId)}
                  active={openAppIds.includes(app.id)}
                  onOpen={(toggle) => onAppOpen(app.id, toggle)}
                  onOpenInHyper={() => onAppOpenInHyper(app.id)}
                  onRename={() => {
                    updateMutation.reset();
                    setRenameTargetId(app.id);
                  }}
                  colorUpdating={updateMutation.isPending}
                  onColorChange={(color) =>
                    updateMutation.mutate({
                      app,
                      update: { color },
                    })
                  }
                  onDelete={() => {
                    deleteMutation.reset();
                    setDeleteTargetId(app.id);
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </SidebarPanel>

      {createDefinition && (
        <CreateAppDialog
          key={createDefinition.id}
          definitionTitle={createDefinition.title}
          isCreating={createMutation.isPending}
          error={createMutation.error?.message ?? null}
          onOpenChange={(open) => {
            if (!open) {
              createMutation.reset();
              setCreateDefinitionId(null);
            }
          }}
          onCreate={(title) =>
            createMutation.mutate({
              definitionId: createDefinition.id,
              title,
            })
          }
        />
      )}

      {renameTarget && (
        <NameDialog
          key={renameTarget.id}
          name={renameTarget.title}
          title="Rename app"
          description="Change how this saved app appears in the Apps list."
          isSubmitting={updateMutation.isPending}
          onOpenChange={(open) => {
            if (!open) {
              updateMutation.reset();
              setRenameTargetId(null);
            }
          }}
          onSubmit={async (title) => {
            const result = await updateMutation.mutateAsync({
              app: renameTarget,
              update: { title },
            });
            if (result.status === "conflict") {
              throw new Error("The app changed repeatedly while being renamed. Try again.");
            }
          }}
        />
      )}

      {installOpen && (
        <InstallAppDialog
          isInstalling={installMutation.isPending}
          error={installMutation.error?.message ?? null}
          onOpenChange={(open) => {
            if (!open) {
              installMutation.reset();
              setInstallOpen(false);
            }
          }}
          onInstall={(url) => installMutation.mutate(url)}
        />
      )}

      {uninstallDefinition && (
        <DestructiveConfirmationDialog
          key={uninstallDefinition.id}
          open
          title={`Uninstall ${uninstallDefinition.title}?`}
          description={
            uninstallInstanceCount > 0
              ? `${uninstallDefinition.title} has ${uninstallInstanceCount} saved ${
                  uninstallInstanceCount === 1 ? "app" : "apps"
                }. Delete ${
                  uninstallInstanceCount === 1 ? "it" : "them"
                } from the Apps list before uninstalling the definition.`
              : "This removes its app.json and app.tsx definition files from this machine."
          }
          confirmLabel={uninstallInstanceCount > 0 ? "Delete saved apps first" : "Uninstall"}
          pendingLabel="Uninstalling…"
          isPending={uninstallMutation.isPending}
          disabled={uninstallInstanceCount > 0}
          error={uninstallMutation.error?.message ?? null}
          onOpenChange={(open) => {
            if (!open) {
              uninstallMutation.reset();
              setUninstallDefinitionId(null);
            }
          }}
          onConfirm={() => uninstallMutation.mutate(uninstallDefinition.id)}
        />
      )}

      <DestructiveConfirmationDialog
        open={deleteTarget !== null}
        title={`Delete ${deleteTarget?.title ?? "app"}?`}
        description="This removes the saved app and its state. Sessions it created remain in Toy Box."
        isPending={deleteMutation.isPending}
        error={deleteMutation.error?.message ?? null}
        onOpenChange={(open) => {
          if (!open) {
            deleteMutation.reset();
            setDeleteTargetId(null);
          }
        }}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
        }}
      />
    </>
  );
}

function AppListItem({
  app,
  definition,
  active,
  onOpen,
  onOpenInHyper,
  onRename,
  colorUpdating,
  onColorChange,
  onDelete,
}: {
  app: AppInstance;
  definition?: AppDefinition;
  active: boolean;
  onOpen: (toggleInWorkspace: boolean) => void;
  onOpenInHyper: () => void;
  onRename: () => void;
  colorUpdating: boolean;
  onColorChange: (color: AppInstance["color"]) => void;
  onDelete: () => void;
}) {
  return (
    <SidebarListItem
      title={app.title}
      icon={
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-white ring-1 ring-black/10"
          style={{ backgroundColor: app.color }}
        >
          {definition ? (
            <DefinitionIcon definition={definition} />
          ) : (
            <AppWindow className="size-4" />
          )}
        </span>
      }
      menuItems={
        <>
          <DropdownMenuItem onSelect={onOpenInHyper}>
            <MessageCirclePlus />
            Open in Hyper
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onRename}>
            <Pencil />
            Rename app
          </DropdownMenuItem>
          <AppColorMenu color={app.color} disabled={colorUpdating} onColorChange={onColorChange} />
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onDelete}>
            <Trash2 />
            Delete app
          </DropdownMenuItem>
        </>
      }
      isActive={active}
      onClick={(event) => onOpen(event.metaKey || event.ctrlKey)}
      titleClassName="text-sm"
    />
  );
}

function DefinitionIcon({ definition }: { definition: AppDefinition }) {
  const Icon = definition.icon ? APP_ICONS[definition.icon] : AppWindow;
  return <Icon className="size-4" />;
}
