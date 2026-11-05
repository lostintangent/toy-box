import { Fragment } from "react";
import { formatForDisplay } from "@tanstack/react-hotkeys";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from "@/shared/ui/dropdown-menu";
import type { Command } from "./command";
import { runCommandFromClick } from "./CommandButton";
import { useCommand } from "./CommandProvider";

/** A menu item for a command, by reference or by id, labeled by the command itself. */
export function CommandMenuItem({
  command: reference,
  className,
}: {
  command: Command | string;
  className?: string;
}) {
  const command = useCommand(reference);
  if (!command) return null;
  const Icon = command.icon;

  return (
    <DropdownMenuItem
      variant={command.destructive ? "destructive" : "default"}
      className={className}
      disabled={command.disabled}
      onClick={(event) => runCommandFromClick(command, event)}
    >
      {Icon && <Icon />}
      {command.title}
      {command.shortcut && (
        <DropdownMenuShortcut suppressHydrationWarning>
          {formatForDisplay(command.shortcut)}
        </DropdownMenuShortcut>
      )}
    </DropdownMenuItem>
  );
}

/** A subject's actions as menu items, with each destructive one set apart. */
export function CommandMenuItems({ commands }: { commands: readonly Command[] }) {
  return commands.map((command) => (
    <Fragment key={command.id}>
      {command.destructive && <DropdownMenuSeparator />}
      <CommandMenuItem command={command} />
    </Fragment>
  ));
}
