import { useRef, useState, type ReactNode } from "react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Hash, MoreHorizontal, PanelRightClose, Pin, PinOff } from "lucide-react";
import { AgentEditor } from "@channels/components/agents/AgentEditor";
import { ChannelDialog } from "@channels/components/ChannelDialog";
import { ChannelMenuItems } from "@channels/components/ChannelMenuItems";
import { DeleteChannelDialog } from "@channels/components/DeleteChannelDialog";
import type { Channel, ChannelArtifact, ChannelMember, ChannelRoutine } from "@channels/model";
import { channelMutations } from "@channels/mutations";
import { FileBrowserDialog } from "@files/components/browser/FileBrowserDialog";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import type { PaneVariant } from "@workspace/components/panes/shell/WorkspacePaneView";
import { PaneActions } from "@workspace/components/panes/shell/PaneSlots";
import {
  PANE_OVERLAY_BUTTON_CLASS,
  PANE_OVERLAY_ICON_CLASS,
} from "@workspace/components/panes/shell/paneControls";
import { Button } from "@/shared/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/shared/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/shared/ui/sheet";
import { DestructiveConfirmationDialog } from "@/shared/sidebar/DestructiveConfirmationDialog";
import { useChannelPane } from "../ChannelPaneContext";
import { ChannelOverviewContent } from "./ChannelOverviewContent";

const OVERVIEW_WIDTH = 320;

/** Closed, open over the transcript as a sheet, or pinned beside it, which the layout remembers. */
type OverviewPresentation = "closed" | "sheet" | "pinned";

type OverviewDialog =
  | { type: "edit_channel" | "delete_channel" | "browse_directory" }
  | { type: "edit_member" | "remove_member"; member: ChannelMember };

/** The Channel's current purpose, progress, shared work, and roster. */
export function ChannelOverview({
  channel,
  artifacts,
  routines,
  variant,
}: {
  channel: Channel;
  artifacts: ChannelArtifact[];
  routines: ChannelRoutine[];
  variant: PaneVariant;
}) {
  const {
    openFile,
    revealFile,
    channelOverviewPinned = false,
    setChannelOverviewPinned,
  } = useWorkspaceSurface();
  const { mention } = useChannelPane();
  const overviewRef = useRef<HTMLDivElement>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [dialog, setDialog] = useState<OverviewDialog>();
  const canPin = variant === "normal";
  const isPinned = canPin && channelOverviewPinned;
  const openLabel = `Open #${channel.name} overview`;
  const trigger = canPin ? (
    <button
      type="button"
      aria-label={openLabel}
      title={openLabel}
      className={PANE_OVERLAY_BUTTON_CLASS}
    >
      <Hash className={PANE_OVERLAY_ICON_CLASS} />
    </button>
  ) : (
    <Button type="button" variant="ghost" size="icon-sm" aria-label={openLabel} title={openLabel}>
      <Hash />
    </Button>
  );

  function present(presentation: OverviewPresentation) {
    setChannelOverviewPinned?.(presentation === "pinned");
    setIsSheetOpen(presentation === "sheet");
  }

  // Acting from the sheet dismisses it, while a pinned rail stays put.
  function closeSheet() {
    setIsSheetOpen(false);
  }

  function openArtifact(artifact: ChannelArtifact) {
    closeSheet();
    revealFile?.(artifact.file);
  }

  function openDialog(next: OverviewDialog) {
    closeSheet();
    setDialog(next);
  }

  function onDialogOpenChange(open: boolean) {
    if (!open) setDialog(undefined);
  }

  const browseDirectory = () => openDialog({ type: "browse_directory" });

  const channelMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Channel actions"
            title="Channel actions"
          />
        }
      >
        <MoreHorizontal />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ChannelMenuItems
          onEdit={() => openDialog({ type: "edit_channel" })}
          onBrowse={channel.directory ? browseDirectory : undefined}
          onDelete={() => openDialog({ type: "delete_channel" })}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const overviewContent = (
    <ChannelOverviewContent
      channel={channel}
      artifacts={artifacts}
      routines={routines}
      onArtifactOpen={openArtifact}
      onEditMember={(member) => openDialog({ type: "edit_member", member })}
      onRemoveMember={(member) => openDialog({ type: "remove_member", member })}
      onAddAgent={() => {
        closeSheet();
        mention();
      }}
      onBrowseDirectory={browseDirectory}
    />
  );

  return (
    <>
      <PaneActions>
        {!isPinned && (
          <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
            <SheetTrigger render={trigger} />
            <SheetContent
              ref={overviewRef}
              initialFocus={overviewRef}
              showCloseButton={false}
              style={canPin ? { width: OVERVIEW_WIDTH } : undefined}
              className="w-[92%] gap-0 overflow-hidden p-0 sm:max-w-md"
            >
              <OverviewHeader
                title={<SheetTitle>{channel.name}</SheetTitle>}
                menu={channelMenu}
                canPin={canPin}
                isPinned={isPinned}
                onPresent={present}
              />
              {overviewContent}
            </SheetContent>
          </Sheet>
        )}
      </PaneActions>

      {/* Closing animates the rail. Switching to the Sheet replaces it immediately. */}
      {!isSheetOpen && (
        <AnimatePresence>
          {isPinned && (
            <m.aside
              key="channel-overview"
              aria-label={`#${channel.name} overview`}
              style={{ width: OVERVIEW_WIDTH }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.2, ease: "easeInOut" }}
              className="col-start-2 row-span-2 row-start-1 min-h-0 overflow-hidden"
            >
              <div
                className="flex h-full flex-col border-l bg-background"
                style={{ width: OVERVIEW_WIDTH }}
              >
                <OverviewHeader
                  title={<h2 className="font-semibold text-foreground">{channel.name}</h2>}
                  menu={channelMenu}
                  canPin={canPin}
                  isPinned={isPinned}
                  onPresent={present}
                />
                {overviewContent}
              </div>
            </m.aside>
          )}
        </AnimatePresence>
      )}

      {dialog?.type === "edit_channel" && (
        <ChannelDialog key={channel.id} channel={channel} onOpenChange={onDialogOpenChange} />
      )}
      {dialog?.type === "edit_member" && (
        <AgentEditor agent={dialog.member} onClose={() => setDialog(undefined)} />
      )}
      {dialog?.type === "delete_channel" && (
        <DeleteChannelDialog channel={channel} onOpenChange={onDialogOpenChange} />
      )}
      {dialog?.type === "browse_directory" && (
        <FileBrowserDialog
          open
          onOpenChange={onDialogOpenChange}
          title="Open a file"
          initialPath={channel.directory}
          onOpenFile={openFile}
        />
      )}
      {dialog?.type === "remove_member" && (
        <DestructiveConfirmationDialog
          key={dialog.member.id}
          title={`Remove ${dialog.member.name}?`}
          description={`This removes ${dialog.member.name} from #${channel.name} and deletes their private channel session. Their messages and reactions remain attributed to Deleted agent.`}
          confirmLabel="Remove"
          pendingLabel="Removing…"
          mutation={channelMutations.removeMember(dialog.member.id)}
          onOpenChange={onDialogOpenChange}
        />
      )}
    </>
  );
}

/** The title and actions, the same whether the overview is a sheet or pinned. */
function OverviewHeader({
  title,
  menu,
  canPin,
  isPinned,
  onPresent,
}: {
  title: ReactNode;
  menu: ReactNode;
  canPin: boolean;
  isPinned: boolean;
  onPresent: (presentation: OverviewPresentation) => void;
}) {
  const pinLabel = isPinned ? "Unpin overview" : "Pin overview";

  return (
    <div className="flex items-center gap-2 border-b px-2.5 py-3">
      <div className="min-w-0 flex-1">{title}</div>
      <div className="flex shrink-0 items-center">
        {menu}
        {canPin && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={pinLabel}
            title={pinLabel}
            // Unpinning keeps the overview open, as a sheet.
            onClick={() => onPresent(isPinned ? "sheet" : "pinned")}
          >
            {isPinned ? <PinOff /> : <Pin />}
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Close overview"
          title="Close overview"
          onClick={() => onPresent("closed")}
        >
          <PanelRightClose />
        </Button>
      </div>
    </div>
  );
}
