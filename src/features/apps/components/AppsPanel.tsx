import { createElement } from "react";
import { mutationOptions, useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { AppWindow, Download, MessageCirclePlus, Plus, Trash2 } from "lucide-react";
import { appCommands } from "@apps/commands";
import { appMutations } from "@apps/mutations";
import { createAppPane, type AppDefinition, type AppInstance } from "@apps/model";
import { appQueries } from "@apps/queries";
import { CommandMenuItems } from "@/shared/commands/CommandMenuItem";
import { Button } from "@/shared/ui/button";
import { DestructiveConfirmationDialog } from "@/shared/dialogs/DestructiveConfirmationDialog";
import { openDialog } from "@/shared/dialogs/DialogHost";
import { NameDialog } from "@/shared/dialogs/NameDialog";
import { SidebarListItem } from "@/shared/sidebar/SidebarListItem";
import { SidebarPanel } from "@/shared/sidebar/SidebarPanel";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { useWorkspaceRoots } from "@workspace/hooks/layout/roots";
import { appIcon } from "./runtime/icons";
import { AppColorMenu } from "./AppColorMenu";
import { InstallAppDialog } from "./InstallAppDialog";

export function AppsPanel({
  isExpanded,
  onExpandedChange,
  onAppOpenInHyper,
}: {
  isExpanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onAppOpenInHyper: (appId: string) => void;
}) {
  const { selectRoot, isOpen } = useWorkspaceRoots();
  const {
    data: { apps, definitions },
  } = useSuspenseQuery({
    ...appQueries.list,
    select: ({ apps, definitions }) => ({ apps, definitions }),
  });

  function openCreateDialog(definition: AppDefinition) {
    openDialog((dialog) => (
      <NameDialog
        {...dialog}
        name=""
        suggestedName={definition.title}
        title={`Save a ${definition.title} app`}
        description="This creates a durable instance with its own state."
        submitLabel="Save app"
        mutation={createAndOpenApp(definition.id, (appId) => selectRoot(createAppPane(appId)))}
      />
    ));
  }

  function openUninstallDialog(definition: AppDefinition) {
    const instanceCount = apps.filter((app) => app.definitionId === definition.id).length;
    openDialog((dialog) => (
      <DestructiveConfirmationDialog
        {...dialog}
        title={`Uninstall ${definition.title}?`}
        description={
          instanceCount > 0
            ? `${definition.title} has ${instanceCount} saved ${
                instanceCount === 1 ? "app" : "apps"
              }. Delete ${
                instanceCount === 1 ? "it" : "them"
              } from the Apps list before uninstalling the definition.`
            : "This removes its app.json and app.tsx definition files from this machine."
        }
        confirmLabel={instanceCount > 0 ? "Delete saved apps first" : "Uninstall"}
        pendingLabel="Uninstalling…"
        disabled={instanceCount > 0}
        mutation={appMutations.uninstall(definition.id)}
      />
    ));
  }

  return (
    <SidebarPanel
      title="Apps"
      isExpanded={isExpanded}
      onExpandedChange={onExpandedChange}
      action={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                aria-label="Add app"
                title="Add app"
              />
            }
          >
            <Plus className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {definitions.map((definition) => (
              <div key={definition.id} className="flex items-center">
                <DropdownMenuItem
                  className="min-w-0 flex-1"
                  onClick={() => openCreateDialog(definition)}
                >
                  <DefinitionIcon definition={definition} />
                  <span className="truncate">{definition.title}</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  variant="destructive"
                  className="size-8 shrink-0 justify-center p-0"
                  aria-label={`Uninstall ${definition.title}`}
                  title={`Uninstall ${definition.title}`}
                  onClick={() => openUninstallDialog(definition)}
                >
                  <Trash2 />
                </DropdownMenuItem>
              </div>
            ))}
            {definitions.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onClick={() => openDialog(InstallAppDialog)}>
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
          active={isOpen(createAppPane(app.id))}
          onOpen={(toggle) => selectRoot(createAppPane(app.id), toggle)}
          onOpenInHyper={() => onAppOpenInHyper(app.id)}
        />
      ))}
    </SidebarPanel>
  );
}

function createAndOpenApp(definitionId: string, open: (appId: string) => void) {
  const create = appMutations.create(definitionId);
  return mutationOptions({
    ...create,
    onSuccess: async (app, ...context) => {
      await create.onSuccess?.(app, ...context);
      open(app.id);
    },
  });
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
  const colorMutation = useMutation(appMutations.update(app));

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
          <DropdownMenuItem onClick={onOpenInHyper}>
            <MessageCirclePlus />
            Open in Hyper
          </DropdownMenuItem>
          <AppColorMenu
            color={app.color}
            disabled={colorMutation.isPending}
            onColorChange={(color) => colorMutation.mutate({ color })}
          />
          <DropdownMenuSeparator />
          <CommandMenuItems commands={appCommands(app)} />
        </>
      }
      isActive={active}
      onClick={(event) => onOpen(event.metaKey || event.ctrlKey)}
    />
  );
}

function DefinitionIcon({ definition }: { definition: AppDefinition }) {
  return createElement(appIcon(definition.icon), { className: "size-4" });
}
