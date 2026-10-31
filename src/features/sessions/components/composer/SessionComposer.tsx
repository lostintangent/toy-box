// Shared composer for session delivery and Inbox creation. Session ID presence is the
// complete host discriminator. A session stacks what it produced and what is waiting above
// the input; the input holds this message's images, text, settings, and send controls.

import { useRef, useState, type KeyboardEvent } from "react";
import { formatForDisplay, matchesKeyboardEvent } from "@tanstack/react-hotkeys";
import { Maximize2, Minimize2, Square } from "lucide-react";
import { Skeleton } from "@/shared/ui/skeleton";
import { Composer, ComposerAction } from "@/shared/composers/Composer";
import { useComposerDraft, type ComposerMessage } from "@/shared/composers/useComposerDraft";
import { promptReferences } from "../references/PromptReferences";
import type { ModelConfiguration, ModelInfo } from "@providers/model";
import type { SessionArtifact, SessionState, TodoItem, UserMessage } from "../../model";
import type { DiffStats } from "@/shared/diffStats";
import { ModelConfigurationPicker } from "@providers/components/ModelPicker";
import {
  SessionLocationPicker,
  type SessionLocationPickerProps,
} from "../location/SessionLocationPicker";
import { ComposerTray } from "../outputs/ComposerTray";
import { WorkspacePreview } from "../outputs/WorkspacePreview";
import type { Preview } from "@/shared/preview";
import { DiffPopup } from "./DiffPopup";
import { ContextMeter } from "./ContextMeter";
import { RunControls, SendControls, sendNowHotkey } from "./DeliveryControls";
import { VoiceButton } from "./VoiceButton";
import { QueuedMessageList, type QueuedMessageListHandle } from "./QueuedMessageList";
import { PromptCompletionMenu } from "./completions/PromptCompletions";
import { promptCompletionSources } from "./completions/completionSources";
import type { VoiceComposerContext } from "./useVoiceComposer";
import type { ChecklistItem } from "@/shared/ui/checklist";
import { sessionFile } from "@files/model";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { useSavedDraft } from "@workspace/hooks/useSavedDraft";
import type { FileDiffSummary } from "../transcript/editDiffs";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/utils";

/** Delivers a message; a returned promise that rejects returns the message to the composer. */
type SendMessage = (
  message: Pick<UserMessage, "content" | "attachments">,
  options?: { immediate?: true },
) => void | Promise<unknown>;

type SessionComposerCommonProps = {
  onSubmit: SendMessage;
  isStreaming?: boolean;
  isBusy?: boolean;
  onStop?: () => void;
  models: ModelInfo[];
  model?: ModelConfiguration | null;
  onModelChange?: (model: ModelConfiguration) => void;
  locationPicker?: SessionLocationPickerProps;
  todos?: TodoItem[];
  sessionDiff?: { total: DiffStats; byFile: FileDiffSummary[] };
  artifacts?: SessionArtifact[];
  onOpenArtifact?: (path: string) => void;
  preview?: Preview;
  /** Working directory whose files and skills the prompt can complete. */
  directory?: string;
  queuedMessages?: SessionState["queuedMessages"];
  /** Context that grounds a voice call in the current session. */
  sessionName?: string;
  lastMessage?: string;
  contextUsage?: SessionState["contextUsage"];
};

type SessionComposerProps = SessionComposerCommonProps &
  (
    | {
        /** The existing session this composes for. */
        sessionId: string;
        onRun?: never;
      }
    | {
        sessionId?: undefined;
        /** Runs a newly composed task under Inbox ownership. */
        onRun: SendMessage;
      }
  );

export function SessionComposer(props: SessionComposerProps) {
  const {
    sessionId,
    onSubmit,
    isStreaming = false,
    isBusy = isStreaming,
    onStop,
    models,
    model,
    onModelChange,
    locationPicker,
    todos,
    sessionDiff,
    artifacts = [],
    onOpenArtifact,
    preview,
    directory,
    queuedMessages = [],
    sessionName,
    lastMessage,
    contextUsage,
  } = props;
  const run = props.sessionId === undefined ? props.onRun : undefined;
  const draft = useComposerDraft({
    ...useSavedDraft(sessionId === undefined ? "inbox" : `session:${sessionId}`),
    // Inbox runs new work by default; a session receives the message.
    onSend: (message) => deliver(run ?? onSubmit, message),
  });
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const { isMobile } = useViewport();
  const environment = useWorkspaceSelector((workspace) => workspace.environment);
  const hyperSessionIds = useWorkspaceSelector((workspace) => workspace.hyperSessionIds);
  const queueHandle = useRef<QueuedMessageListHandle>(null);
  const queuedInputs = queuedMessages.flatMap((message) =>
    message.role === "user" && message.status === "queued" ? [message] : [],
  );
  const hasDiff = sessionDiff && (sessionDiff.total.added > 0 || sessionDiff.total.removed > 0);
  // Desktop teaches one relevant shortcut while a turn runs.
  const placeholder = !isBusy
    ? "Ask a question or describe your idea..."
    : isMobile
      ? "Queue a follow-up"
      : `Queue a follow-up · ${queuedInputs.length > 0 ? "↑ edits the last queued message" : `${formatForDisplay(sendNowHotkey)} sends it now`}`;

  /** Hands a sent draft to `target`, collapsing the editor for the next message. */
  function deliver(target: SendMessage, message: ComposerMessage, immediate?: true) {
    setIsExpanded(false);
    return target(message, immediate ? { immediate } : undefined);
  }
  /** Sends the draft somewhere other than its default, from a menu or shortcut. */
  const sendTo = (target: SendMessage, immediate?: true) =>
    draft.submit((message) => deliver(target, message, immediate));

  // Stopping drops the queue, so queued input returns to the draft.
  const stop =
    onStop &&
    (() => {
      draft.append(...queuedInputs);
      onStop();
    });

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (isBusy && matchesKeyboardEvent(event.nativeEvent, sendNowHotkey)) {
      event.preventDefault();
      sendTo(onSubmit, true);
    } else if (event.key === "ArrowUp" && draft.value === "" && queuedInputs.length > 0) {
      event.preventDefault();
      queueHandle.current?.editLast();
    }
  }

  // The voice tools read this through a ref, so every call sees current composer state.
  const voiceContext: VoiceComposerContext = {
    readPrompt: () => draft.value,
    models,
    model: model ?? null,
    setPrompt: draft.setValue,
    submitPrompt: () => draft.submit(),
    setModel: onModelChange ?? (() => {}),
    session:
      sessionId === undefined
        ? undefined
        : { name: sessionName ?? "", lastMessage: lastMessage ?? "" },
  };

  return (
    <Composer
      draft={draft}
      tray={
        sessionId && (
          // One tray docked to the input holds what the session made and what waits to send.
          <ComposerTray
            artifacts={[...artifacts]
              .sort((left, right) => right.updatedAt - left.updatedAt)
              .map(({ path, updatedAt }) => ({
                file: sessionFile(sessionId, path),
                time: updatedAt,
              }))}
            artifactTimeLabel="Updated"
            onOpenArtifact={onOpenArtifact && ((file) => onOpenArtifact(file.path))}
            checklist={getDisplayTodos(todos ?? [], isBusy)}
            checklistLabel="Todos"
            extraOutput={
              preview || hasDiff ? (
                <>
                  {preview && <WorkspacePreview preview={preview} />}
                  {hasDiff && <DiffPopup total={sessionDiff.total} byFile={sessionDiff.byFile} />}
                </>
              ) : undefined
            }
          >
            <QueuedMessageList
              sessionId={sessionId}
              messages={queuedMessages}
              handle={queueHandle}
              onEdit={(message) => {
                draft.append(message);
                draft.focus();
              }}
            />
          </ComposerTray>
        )
      }
      completions={{
        sources: promptCompletionSources({
          sessionId,
          directory,
          provider: model?.provider,
          hyperSessionIds,
        }),
        menu: (completions) => <PromptCompletionMenu completions={completions} />,
      }}
      controls={
        <>
          {locationPicker && <SessionLocationPicker {...locationPicker} />}
          {(models.length === 0 || !model) && <ModelConfigurationSkeleton />}
          {models.length > 0 && model && onModelChange && (
            <ModelConfigurationPicker models={models} value={model} onValueChange={onModelChange} />
          )}
          {contextUsage && <ContextMeter usage={contextUsage} />}
        </>
      }
      actions={
        <>
          {(isExpanded || isOverflowing) && (
            <ComposerAction
              label={isExpanded ? "Collapse editor" : "Expand editor"}
              aria-pressed={isExpanded}
              onClick={() => setIsExpanded(!isExpanded)}
            >
              {isExpanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </ComposerAction>
          )}
          {
            // Stream start unmounts and disconnects session voice; home stays mounted.
            environment.voiceEnabled && !isStreaming && <VoiceButton context={voiceContext} />
          }
          {isStreaming && stop && (
            <ComposerAction label="Stop turn" variant="destructive-ghost" onClick={stop}>
              <Square className="h-4 w-4" />
            </ComposerAction>
          )}
          {run ? (
            <RunControls draft={draft} onSend={() => sendTo(onSubmit)} />
          ) : (
            <SendControls draft={draft} isBusy={isBusy} onSendNow={() => sendTo(onSubmit, true)} />
          )}
        </>
      }
      label="Message"
      placeholder={placeholder}
      references={promptReferences}
      onOverflowChange={setIsOverflowing}
      inputClassName={cn(isExpanded && "max-h-[70dvh] min-h-[50dvh]")}
      onKeyDown={handleKeyDown}
    />
  );
}

function ModelConfigurationSkeleton() {
  return (
    <div className="flex items-center gap-1" aria-label="Loading model configuration">
      <Skeleton className="h-6 w-20 rounded-md" />
      <Skeleton className="h-6 w-14 rounded-md" />
    </div>
  );
}

/** While the assistant works without an active todo, its next pending todo reads as in progress. */
function getDisplayTodos(todos: TodoItem[], isBusy: boolean): ChecklistItem[] {
  const hasActiveTodo = todos.some((todo) => todo.status === "in_progress");
  let promotedPending = false;

  return todos.map((todo) => {
    if (isBusy && !hasActiveTodo && !promotedPending && todo.status === "pending") {
      promotedPending = true;
      return { ...todo, status: "in_progress" };
    }
    return todo;
  });
}
