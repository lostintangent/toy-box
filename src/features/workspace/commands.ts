import {
  Clock3,
  FileText,
  Folder,
  Hash,
  Inbox,
  MessageCirclePlus,
  Monitor,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Shapes,
  SquareTerminal,
} from "lucide-react";
import { ALTERNATE_SHORTCUT, type Command } from "@/shared/commands/command";
import { openWorkspaceDialog } from "./hooks/dialogs";

export type SessionCreationOptions = {
  addToWorkspace?: boolean;
  artifact?: { path: string; content: string };
};

type Toggle = { isOpen: boolean; toggle: () => void };

/**
 * The workbench's commands: creating work and showing its surfaces. The route that owns their state
 * provides them, so the sidebar's actions, the shortcuts and the palette all run the same ones.
 */
export function workspaceCommands({
  togglePalette,
  sidebar,
  terminal,
  hyper,
  inbox,
  hasModels,
  createSession,
}: {
  togglePalette: () => void;
  /** Only a desktop sidebar collapses. */
  sidebar?: Toggle;
  terminal: Toggle;
  hyper: Toggle;
  inbox: { isOpen: boolean; open: () => void };
  hasModels: boolean;
  createSession: (options?: SessionCreationOptions) => void;
}): Command[] {
  const createArtifact = (path: string, content = "") =>
    createSession({ artifact: { path, content } });

  return [
    {
      id: "workspace.search",
      title: "Search",
      group: "Workspace",
      icon: Search,
      shortcut: "Mod+K",
      run: togglePalette,
    },
    {
      id: "session.create",
      title: "New session",
      group: "Create",
      icon: Plus,
      shortcut: "Control+N",
      disabled: !hasModels,
      actions: [
        {
          id: "session.create.addToWorkspace",
          title: "Add to workspace",
          icon: Plus,
          shortcut: ALTERNATE_SHORTCUT,
          disabled: !hasModels,
          run: () => createSession({ addToWorkspace: true }),
        },
      ],
      run: () => createSession(),
    },
    {
      id: "session.createDocument",
      title: "New document",
      group: "Create",
      icon: FileText,
      disabled: !hasModels,
      run: () => createArtifact("document.md"),
    },
    {
      id: "session.createWhiteboard",
      title: "New whiteboard",
      group: "Create",
      icon: Shapes,
      disabled: !hasModels,
      run: () =>
        createArtifact(
          "diagram.svg",
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"></svg>\n',
        ),
    },
    {
      id: "automation.create",
      title: "New automation",
      group: "Create",
      icon: Clock3,
      disabled: !hasModels,
      run: () => openWorkspaceDialog({ kind: "automation" }),
    },
    {
      id: "channel.create",
      title: "New channel",
      group: "Create",
      icon: Hash,
      disabled: !hasModels,
      run: () => openWorkspaceDialog({ kind: "channel" }),
    },
    {
      id: "workspace.openInbox",
      title: "Open Inbox",
      group: "Workspace",
      icon: Inbox,
      checked: inbox.isOpen,
      run: inbox.open,
    },
    {
      id: "workspace.toggleHyper",
      title: hyper.isOpen ? "Close Hyper" : "Open Hyper",
      group: "Workspace",
      icon: MessageCirclePlus,
      checked: hyper.isOpen,
      disabled: !hasModels,
      run: hyper.toggle,
    },
    ...(sidebar
      ? [
          {
            id: "workspace.toggleSidebar",
            title: sidebar.isOpen ? "Hide sidebar" : "Show sidebar",
            group: "Workspace",
            icon: PanelLeft,
            shortcut: "Mod+B",
            checked: sidebar.isOpen,
            run: sidebar.toggle,
          } satisfies Command,
        ]
      : []),
    {
      id: "workspace.toggleTerminal",
      title: terminal.isOpen ? "Hide terminal" : "Show terminal",
      group: "Workspace",
      icon: SquareTerminal,
      shortcut: "Control+`",
      checked: terminal.isOpen,
      run: terminal.toggle,
    },
    {
      id: "files.browse",
      title: "Browse files",
      group: "Workspace",
      icon: Folder,
      run: () => openWorkspaceDialog({ kind: "files" }),
    },
    {
      id: "screens.browse",
      title: "Browse screens",
      group: "Workspace",
      icon: Monitor,
      run: () => openWorkspaceDialog({ kind: "screens" }),
    },
    {
      id: "workspace.settings",
      title: "Open settings",
      group: "Workspace",
      icon: Settings,
      run: () => openWorkspaceDialog({ kind: "settings" }),
    },
  ];
}
