import { useState } from "react";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { AppWindow, Download, MessageCirclePlus, Pencil, Plus, Trash2 } from "lucide-react";
import { appMutations } from "@apps/mutations";
import type { AppDefinition, AppInstance } from "@apps/model";
import { appQueries } from "@apps/queries";
import { Button } from "@/shared/components/ui/button";
import { DestructiveConfirmationDialog } from "@/shared/components/sidebar/DestructiveConfirmationDialog";
import { NameDialog } from "@/shared/components/sidebar/NameDialog";
import { SidebarListItem } from "@/shared/components/sidebar/SidebarListItem";
import { SidebarPanel } from "@/shared/components/sidebar/SidebarPanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { APP_ICONS } from "./runtime/icons";
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
  const { data } = useSuspenseQuery(appQueries.list());
  const { apps, definitions } = data;
  const [createDefinitionId, setCreateDefinitionId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [uninstallDefinitionId, setUninstallDefinitionId] = useState<string | null>(null);

  const createDefinition =
    definitions.find((definition) => definition.id === createDefinitionId) ?? null;
  const uninstallDefinition =
    definitions.find((definition) => definition.id === uninstallDefinitionId) ?? null;
  const uninstallInstanceCount = uninstallDefinition
    ? apps.filter((app) => app.definitionId === uninstallDefinition.id).length
    : 0;

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
                    onSelect={() => setCreateDefinitionId(definition.id)}
                  >
                    <DefinitionIcon definition={definition} />
                    <span className="truncate">{definition.title}</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="size-8 shrink-0 justify-center p-0 text-muted-foreground focus:text-destructive"
                    aria-label={`Uninstall ${definition.title}`}
                    title={`Uninstall ${definition.title}`}
                    onSelect={() => setUninstallDefinitionId(definition.id)}
                  >
                    <Trash2 />
                  </DropdownMenuItem>
                </div>
              ))}
              {definitions.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuItem onSelect={() => setInstallOpen(true)}>
                <Download />
                Install from Gist…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
        emptyMessage="Saved apps will stay here for quick reopening."
      >
        {apps.map((app) => (
          <AppListItem
            key={app.id}
            app={app}
            definition={definitions.find(({ id }) => id === app.definitionId)}
            active={openAppIds.includes(app.id)}
            onOpen={(toggle) => onAppOpen(app.id, toggle)}
            onOpenInHyper={() => onAppOpenInHyper(app.id)}
          />
        ))}
      </SidebarPanel>

      {createDefinition && (
        <CreateAppDialog
          key={createDefinition.id}
          definitionId={createDefinition.id}
          definitionTitle={createDefinition.title}
          onOpenChange={(open) => {
            if (!open) setCreateDefinitionId(null);
          }}
          onCreated={(app) => {
            setCreateDefinitionId(null);
            onAppOpen(app.id, false);
          }}
        />
      )}

      {installOpen && (
        <InstallAppDialog
          onOpenChange={(open) => {
            if (!open) setInstallOpen(false);
          }}
          onInstalled={(app) => {
            setInstallOpen(false);
            onAppOpen(app.id, false);
          }}
        />
      )}

      {uninstallDefinition && (
        <DestructiveConfirmationDialog
          key={uninstallDefinition.id}
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
          disabled={uninstallInstanceCount > 0}
          mutation={appMutations.uninstall(uninstallDefinition.id)}
          onOpenChange={(open) => {
            if (!open) setUninstallDefinitionId(null);
          }}
        />
      )}
    </>
  );
}

function AppListItem({
  app,
  definition,
  active,
  onOpen,
  onOpenInHyper,
}: {
  app: AppInstance;
  definition?: AppDefinition;
  active: boolean;
  onOpen: (toggleInWorkspace: boolean) => void;
  onOpenInHyper: () => void;
}) {
  const [dialog, setDialog] = useState<"rename" | "delete" | null>(null);
  const colorMutation = useMutation(appMutations.update(app));

  return (
    <>
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
            <DropdownMenuItem onSelect={() => setDialog("rename")}>
              <Pencil />
              Rename app
            </DropdownMenuItem>
            <AppColorMenu
              color={app.color}
              disabled={colorMutation.isPending}
              onColorChange={(color) => colorMutation.mutate({ color })}
            />
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => setDialog("delete")}
            >
              <Trash2 />
              Delete app
            </DropdownMenuItem>
          </>
        }
        isActive={active}
        onClick={(event) => onOpen(event.metaKey || event.ctrlKey)}
        titleClassName="text-sm"
      />
      {dialog === "rename" && (
        <NameDialog
          name={app.title}
          title="Rename app"
          description="Change how this saved app appears in the Apps list."
          mutation={appMutations.rename(app)}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}
      {dialog === "delete" && (
        <DestructiveConfirmationDialog
          title={`Delete ${app.title}?`}
          description="This removes the saved app and its state. Sessions it created remain in Toy Box."
          mutation={appMutations.delete(app.id)}
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
        />
      )}
    </>
  );
}

function DefinitionIcon({ definition }: { definition: AppDefinition }) {
  const Icon = definition.icon ? APP_ICONS[definition.icon] : AppWindow;
  return <Icon className="size-4" />;
}
