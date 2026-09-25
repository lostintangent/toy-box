// Shared composer for session delivery and Inbox creation. Session ID presence is the
// complete host discriminator. A session stacks what it produced and what is waiting above
// the input; the input holds this message's images, text, settings, and send controls.

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { formatForDisplay, matchesKeyboardEvent } from "@tanstack/react-hotkeys";
import { ArrowUp, ChevronDown, Maximize2, Minimize2, Play, Square } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { Skeleton } from "@/shared/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/shared/ui/input-group";
import type { ModelConfiguration, ModelInfo } from "@providers/model";
import type {
  SessionArtifact,
  SessionSkill,
  SessionState,
  TodoItem,
  UserMessage,
} from "../../model";
import type { DiffStats } from "../../model/fileDiffs";
import { ModelConfigurationPicker } from "@providers/components/ModelPicker";
import {
  SessionLocationPicker,
  type SessionLocationPickerProps,
} from "../location/SessionLocationPicker";
import { SessionOutputs } from "./SessionOutputs";
import { VoiceButton } from "./VoiceButton";
import { QueuedMessageList, type QueuedMessageListHandle } from "./QueuedMessageList";
import {
  AttachImageButton,
  ImageAttachments,
} from "@/shared/composers/attachments/ImageAttachments";
import { useAttachments } from "@/shared/composers/attachments/useAttachments";
import { PromptCompletionMenu, usePromptCompletions } from "./completions/PromptCompletions";
import type { VoiceComposerContext } from "./useVoiceComposer";
import { TypingEffect } from "@/shared/composers/typing-effect/TypingEffect";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { useDraftPrompt } from "../../useDraftPrompt";
import type { FileDiffSummary } from "../transcript/editDiffs";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/utils";

type ComposerPromptBinding =
  | { sessionId: string }
  | {
      prompt: string;
      onPromptChange: (prompt: string) => void;
    };

type SessionComposerCommonProps = {
  onSubmit: (
    message: Pick<UserMessage, "content" | "attachments">,
    options?: { immediate?: true },
  ) => void;
  isStreaming?: boolean;
  onStop?: () => void;
  models: ModelInfo[];
  model?: ModelConfiguration | null;
  onModelChange?: (model: ModelConfiguration) => void;
  locationPicker?: SessionLocationPickerProps;
  todos?: TodoItem[];
  skills?: SessionSkill[];
  showGlobalSkillBadges?: boolean;
  sessionDiff?: { total: DiffStats; byFile: FileDiffSummary[] };
  artifacts?: SessionArtifact[];
  /** Working directory whose files the prompt can reference. */
  directory?: string;
  queuedMessages?: SessionState["queuedMessages"];
  /** Context that grounds a voice call in the current session. */
  sessionName?: string;
  lastMessage?: string;
};

type SessionComposerProps = SessionComposerCommonProps &
  (
    | {
        /** Identifies the existing session whose draft receives onSubmit. */
        sessionId: string;
        prompt?: never;
        onPromptChange?: never;
        onRun?: never;
      }
    | {
        sessionId?: undefined;
        prompt: string;
        onPromptChange: (prompt: string) => void;
        /** Runs a newly composed task under Inbox ownership. */
        onRun: SessionComposerCommonProps["onSubmit"];
      }
  );

function ModelConfigurationSkeleton() {
  return (
    <div className="flex items-center gap-1" aria-label="Loading model configuration">
      <Skeleton className="h-6 w-20 rounded-md" />
      <Skeleton className="h-6 w-14 rounded-md" />
    </div>
  );
}

type ComposerPromptHandle = {
  prompt: string;
  setPrompt: (prompt: string) => void;
  resetAfterSubmit: () => void;
  focus: () => void;
};

type ComposerPromptProps = {
  binding: ComposerPromptBinding;
  promptHandle: React.RefObject<ComposerPromptHandle | null>;
  hasAttachments: boolean;
  isAttaching: boolean;
  isStreaming: boolean;
  onStop?: () => void;
  onSubmit: (immediate?: true) => void;
  onRun?: () => void;
  onSend?: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  onRemoveLastAttachment: () => void;
  /** Present while a queued message can be edited; moves the last one into the composer. */
  onEditLastQueued?: () => void;
  skills?: SessionSkill[];
  directory?: string;
  showGlobalSkillBadges: boolean;
  // Parent-owned slots retain their element identity while draft text changes.
  leadingControls: React.ReactNode;
  voiceControl: React.ReactNode;
};

function ComposerPrompt({
  binding,
  promptHandle,
  hasAttachments,
  isAttaching,
  isStreaming,
  onStop,
  onSubmit,
  onRun,
  onSend,
  onPaste,
  onRemoveLastAttachment,
  onEditLastQueued,
  skills,
  directory,
  showGlobalSkillBadges,
  leadingControls,
  voiceControl,
}: ComposerPromptProps) {
  const isControlled = "prompt" in binding;
  const sessionId = isControlled ? undefined : binding.sessionId;
  const sharedPrompt = useWorkspaceSelector((workspace) =>
    sessionId === undefined ? null : (workspace.sessionStates[sessionId]?.prompt ?? null),
  );
  const draft = useDraftPrompt(sessionId, sharedPrompt);
  const prompt = isControlled ? binding.prompt : draft.prompt;
  const onPromptChange = isControlled ? binding.onPromptChange : draft.setPrompt;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const { isMobile } = useViewport();
  const completions = usePromptCompletions({
    prompt,
    onPromptChange,
    textareaRef,
    skills,
    directory,
  });
  const isSubmitDisabled = isAttaching || (!prompt.trim() && !hasAttachments);
  const submitButtonVariant = isSubmitDisabled ? "ghost" : "accent";
  const submitLabel = isStreaming ? "Queue message" : "Send message";
  const sendNowShortcut = formatForDisplay("Mod+Enter");
  // Desktop teaches one relevant shortcut while a turn runs.
  const placeholder = !isStreaming
    ? "Ask a question or describe your idea..."
    : isMobile
      ? "Queue a follow-up"
      : `Queue a follow-up · ${onEditLastQueued ? "↑ edits the last queued message" : `${sendNowShortcut} sends it now`}`;

  useImperativeHandle(promptHandle, () => ({
    prompt,
    setPrompt: onPromptChange,
    resetAfterSubmit: () => {
      onPromptChange("");
      setIsExpanded(false);
      if (!isControlled) draft.flush();
    },
    // Defer a frame so programmatic prompt changes render before the caret moves to the end.
    focus: () =>
      requestAnimationFrame(() => {
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
      }),
  }));

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (completions.handleKeyDown(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit(
        isStreaming && matchesKeyboardEvent(event.nativeEvent, "Mod+Enter") ? true : undefined,
      );
    } else if (event.key === "Backspace" && prompt === "" && hasAttachments) {
      event.preventDefault();
      onRemoveLastAttachment();
    } else if (event.key === "ArrowUp" && prompt === "" && onEditLastQueued) {
      event.preventDefault();
      onEditLastQueued();
    }
  }

  return (
    <>
      <PromptCompletionMenu
        completions={completions}
        showGlobalSkillBadges={showGlobalSkillBadges}
      />
      <InputGroupTextarea
        ref={textareaRef}
        value={prompt}
        onChange={completions.handleChange}
        onSelect={completions.handleSelect}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        placeholder={placeholder}
        className={cn(
          "min-h-14 overflow-y-auto py-2 text-sm",
          isExpanded ? "max-h-[70dvh] min-h-[50dvh]" : "max-h-[40dvh]",
        )}
        rows={1}
      />

      <InputGroupAddon align="block-end" className="relative justify-between px-2 pt-0 pb-2">
        <TypingEffect value={prompt} />
        <div className="relative flex min-w-0 items-center gap-1">{leadingControls}</div>

        <div className="relative flex items-center gap-0.5">
          {(isExpanded || prompt.includes("\n")) && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    size="icon-xs"
                    aria-label={isExpanded ? "Collapse editor" : "Expand editor"}
                    aria-pressed={isExpanded}
                    onClick={() => setIsExpanded(!isExpanded)}
                  >
                    {isExpanded ? (
                      <Minimize2 className="size-4" />
                    ) : (
                      <Maximize2 className="size-4" />
                    )}
                  </InputGroupButton>
                }
              />
              <TooltipContent sideOffset={6}>{isExpanded ? "Collapse" : "Expand"}</TooltipContent>
            </Tooltip>
          )}
          {voiceControl}
          {isStreaming && onStop && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    size="icon-xs"
                    variant="destructive-ghost"
                    aria-label="Stop turn"
                    onClick={onStop}
                    suppressHydrationWarning
                  >
                    <Square className="h-4 w-4" />
                  </InputGroupButton>
                }
              />
              <TooltipContent sideOffset={6}>Stop turn</TooltipContent>
            </Tooltip>
          )}
          {!isControlled ? (
            <div className="flex">
              <Tooltip>
                <TooltipTrigger
                  render={
                    <InputGroupButton
                      type="submit"
                      size="icon-xs"
                      aria-label={submitLabel}
                      disabled={isSubmitDisabled}
                      variant={submitButtonVariant}
                      suppressHydrationWarning
                      className={isStreaming ? "rounded-e-none" : undefined}
                    >
                      <ArrowUp className="h-4 w-4" />
                    </InputGroupButton>
                  }
                />
                <TooltipContent sideOffset={6}>{submitLabel}</TooltipContent>
              </Tooltip>
              {isStreaming && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <InputGroupButton
                        size="icon-xs"
                        aria-label="Message delivery options"
                        disabled={isSubmitDisabled}
                        variant={submitButtonVariant}
                        suppressHydrationWarning
                        className="w-4 rounded-s-none border-l border-background data-[popup-open]:bg-accent/90"
                      />
                    }
                  >
                    <ChevronDown className="h-3 w-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" finalFocus={false}>
                    <DropdownMenuItem onClick={() => onSubmit()}>
                      <ArrowUp />
                      Queue message
                      <DropdownMenuShortcut>{formatForDisplay("Enter")}</DropdownMenuShortcut>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onSubmit(true)}>
                      <Play />
                      Send immediately
                      <DropdownMenuShortcut>{sendNowShortcut}</DropdownMenuShortcut>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ) : (
            <div className="flex items-center rounded-[calc(var(--radius)-5px)]">
              <InputGroupButton
                type="submit"
                size="icon-xs"
                aria-label="Run"
                disabled={isSubmitDisabled}
                variant={submitButtonVariant}
                suppressHydrationWarning
                className="rounded-e-none"
              >
                <Play className="h-4 w-4" />
              </InputGroupButton>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <InputGroupButton
                      size="icon-xs"
                      aria-label="Run options"
                      disabled={isSubmitDisabled}
                      variant={submitButtonVariant}
                      suppressHydrationWarning
                      className="w-4 rounded-s-none border-l border-background data-[popup-open]:bg-accent/90"
                    />
                  }
                >
                  <ChevronDown className="h-3 w-3" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  // Let submission's textarea focus stand instead of
                  // returning focus to the chevron trigger.
                  finalFocus={false}
                >
                  <DropdownMenuItem onClick={onRun}>
                    <Play />
                    <div className="flex flex-col">
                      <span>Run</span>
                      <span className="text-xs text-muted-foreground">
                        Sends the result to Inbox
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={onSend}>
                    <ArrowUp />
                    <div className="flex flex-col">
                      <span>Send</span>
                      <span className="text-xs text-muted-foreground">
                        Adds the session to your list
                      </span>
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </InputGroupAddon>
    </>
  );
}

export function SessionComposer(props: SessionComposerProps) {
  const {
    sessionId,
    onSubmit,
    onRun,
    isStreaming = false,
    onStop,
    models,
    model,
    onModelChange,
    locationPicker,
    todos,
    skills,
    showGlobalSkillBadges = false,
    sessionDiff,
    artifacts = [],
    directory,
    queuedMessages = [],
    sessionName,
    lastMessage,
  } = props;
  const promptHandle = useRef<ComposerPromptHandle>(null);
  const { isMobile } = useViewport();
  const environment = useWorkspaceSelector((workspace) => workspace.environment);
  const createsSession = sessionId === undefined;
  const promptBinding: ComposerPromptBinding =
    sessionId === undefined
      ? {
          prompt: props.prompt,
          onPromptChange: props.onPromptChange,
        }
      : { sessionId };

  const attachments = useAttachments();
  const queueHandle = useRef<QueuedMessageListHandle>(null);

  useEffect(() => {
    if (!isMobile) promptHandle.current?.focus();
  }, [isMobile]);

  /** Append input taken out of the queue to the unsent draft. */
  const restoreToDraft = (inputs: Pick<UserMessage, "content" | "attachments">[]) => {
    const handle = promptHandle.current;
    if (!handle || inputs.length === 0) return;
    handle.setPrompt(
      [handle.prompt, ...inputs.map(({ content }) => content)]
        .filter((text) => text.trim())
        .join("\n\n"),
    );
    attachments.append(inputs.flatMap((input) => input.attachments ?? []));
  };

  // Stopping drops the queue, so queued input returns to the draft.
  const stop =
    onStop &&
    (() => {
      restoreToDraft(
        queuedMessages.flatMap((message) =>
          message.role === "user" && message.status === "queued" ? [message] : [],
        ),
      );
      onStop();
    });

  const submitWith = (
    submitter: SessionComposerCommonProps["onSubmit"] | undefined,
    immediate?: true,
  ) => {
    const prompt = promptHandle.current?.prompt.trim() ?? "";
    if (attachments.pendingCount > 0 || (!prompt && attachments.items.length === 0) || !submitter)
      return false;
    submitter(
      {
        content: prompt,
        attachments: attachments.items.length > 0 ? attachments.items : undefined,
      },
      immediate ? { immediate } : undefined,
    );
    promptHandle.current?.resetAfterSubmit();
    attachments.clear();
    promptHandle.current?.focus();
    return true;
  };

  const submit = (immediate?: true) => submitWith(createsSession ? onRun : onSubmit, immediate);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  // The voice tools read this through a ref, so every call sees current composer state.
  const voiceContext: VoiceComposerContext = {
    readPrompt: () => promptHandle.current?.prompt ?? "",
    models,
    model: model ?? null,
    setPrompt: (text) => promptHandle.current?.setPrompt(text),
    submitPrompt: submit,
    setModel: onModelChange ?? (() => {}),
    session: createsSession
      ? undefined
      : { name: sessionName ?? "", lastMessage: lastMessage ?? "" },
  };

  return (
    <form
      onSubmit={handleSubmit}
      {...attachments.dropTargetProps}
      className="@container w-full"
      suppressHydrationWarning
    >
      <input {...attachments.fileInputProps} suppressHydrationWarning />

      {sessionId && (
        // One tray docked to the input holds what the session made and what waits to send.
        <div className="mx-2 rounded-t-lg border border-b-0 bg-secondary-background p-1 empty:hidden">
          <SessionOutputs
            sessionId={sessionId}
            artifacts={artifacts}
            todos={todos}
            isStreaming={isStreaming}
            sessionDiff={sessionDiff}
          />
          <QueuedMessageList
            sessionId={sessionId}
            messages={queuedMessages}
            handle={queueHandle}
            onEdit={(message) => {
              restoreToDraft([message]);
              promptHandle.current?.focus();
            }}
          />
        </div>
      )}

      <InputGroup className={cn(attachments.isDragging && "border-ring ring-[3px] ring-ring/50")}>
        <ImageAttachments
          attachments={attachments.items}
          pendingCount={attachments.pendingCount}
          isDragging={attachments.isDragging}
          onRemove={attachments.remove}
        />
        <ComposerPrompt
          key={sessionId ?? "controlled"}
          binding={promptBinding}
          promptHandle={promptHandle}
          hasAttachments={attachments.items.length > 0}
          isAttaching={attachments.pendingCount > 0}
          isStreaming={isStreaming}
          onStop={stop}
          onSubmit={submit}
          onRun={createsSession ? () => submitWith(onRun) : undefined}
          onSend={createsSession ? () => submitWith(onSubmit) : undefined}
          onPaste={attachments.handlePaste}
          onRemoveLastAttachment={attachments.removeLast}
          onEditLastQueued={
            queuedMessages.some(({ role, status }) => role === "user" && status === "queued")
              ? () => queueHandle.current?.editLast()
              : undefined
          }
          skills={skills}
          directory={directory}
          showGlobalSkillBadges={showGlobalSkillBadges}
          leadingControls={
            <>
              <AttachImageButton onClick={attachments.openPicker} />

              {locationPicker && <SessionLocationPicker {...locationPicker} />}

              {(models.length === 0 || !model) && <ModelConfigurationSkeleton />}

              {models.length > 0 && model && onModelChange && (
                <ModelConfigurationPicker
                  models={models}
                  value={model}
                  onValueChange={onModelChange}
                />
              )}
            </>
          }
          voiceControl={
            // Stream start unmounts and disconnects session voice; home stays mounted.
            environment.voiceEnabled && !isStreaming ? <VoiceButton context={voiceContext} /> : null
          }
        />
      </InputGroup>
    </form>
  );
}
