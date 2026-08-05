import { useState } from "react";
import { Leafnode, type LeafnodeAgentRequest, type LeafnodeTheme } from "@lostintangent/leafnode";
import {
  Braces,
  Check,
  ChevronDown,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Redo2,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { PaneActions, usePaneActionsAvailable } from "../../../shell/PaneSlots";
import { PANE_OVERLAY_BUTTON_CLASS } from "../../../shell/paneControls";
import type { EditorProps } from "../index";
import { AgentPrompt } from "./agent/AgentPrompt";
import { activePointersOf } from "./agent/bridge";

const LEAFNODE_THEME = {
  accent: "var(--user-accent)",
  background: "var(--background)",
  muted: "var(--muted-foreground)",
  text: "var(--foreground)",
} satisfies LeafnodeTheme;

export function JsonEditor({ mode, variant, file, pendingWorkers, spawnWorker }: EditorProps) {
  const [agentRequest, setAgentRequest] = useState<LeafnodeAgentRequest | null>(null);
  const paneActionsAvailable = usePaneActionsAvailable();

  return (
    <>
      <Leafnode
        content={file.content ?? ""}
        onContentChanged={mode === "read" ? undefined : file.save}
        theme={LEAFNODE_THEME}
        agent={
          spawnWorker
            ? {
                activePointers: activePointersOf(pendingWorkers),
                onRequest: setAgentRequest,
              }
            : undefined
        }
        renderToolbar={
          paneActionsAvailable
            ? (actions) => (
                <PaneActions>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        aria-label="JSON view options"
                        title="View options"
                        className={cn(
                          "flex shrink-0 items-center gap-1 text-xs transition-colors",
                          variant === "normal"
                            ? PANE_OVERLAY_BUTTON_CLASS
                            : "rounded-md px-2 py-1.5 hover:bg-muted",
                        )}
                      >
                        <Braces className="size-3.5" />
                        {actions.copied ? (
                          <Check className="size-3 text-green-500" />
                        ) : (
                          <ChevronDown className="size-3 opacity-60" />
                        )}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="end"
                      onCloseAutoFocus={(event) => event.preventDefault()}
                    >
                      <DropdownMenuItem disabled={!actions.canUndo} onSelect={actions.undo}>
                        <Undo2 />
                        Undo
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!actions.canRedo} onSelect={actions.redo}>
                        <Redo2 />
                        Redo
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={actions.expandAll}>
                        <ChevronsUpDown />
                        Expand all
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={actions.collapseAll}>
                        <ChevronsDownUp />
                        Collapse all
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => void actions.copyJson()}>
                        <Copy />
                        Copy JSON
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </PaneActions>
              )
            : undefined
        }
      />
      {agentRequest && spawnWorker && (
        <AgentPrompt
          request={agentRequest}
          spawnWorker={spawnWorker}
          onDismiss={() => setAgentRequest(null)}
        />
      )}
    </>
  );
}
