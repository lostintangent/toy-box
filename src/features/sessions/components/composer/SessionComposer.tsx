// Shared composer for session delivery and Inbox creation. Session ID
// presence is the complete host discriminator.

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUp, ChevronDown, Play, Square } from "lucide-react";
import { AgentPicker } from "@agents/components/AgentPicker";
import { agentPickerSuggestions } from "@agents/components/agentPickerSuggestions";
import { AgentInvitationChips } from "@agents/components/AgentInvitationChips";
import { useAgentMentionInput } from "@agents/components/useAgentMentionInput";
import {
  agentHandleFromName,
  findMentionedAgents,
  type Agent,
  type AgentExecutionMode,
  type AgentMention,
} from "@agents/model";
import { agentQueries } from "@agents/queries";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Skeleton } from "@/shared/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/shared/components/ui/input-group";
import type { ModelConfiguration } from "../../model/modelConfiguration";
import {
  type ModelInfo,
  type QueuedMessage,
  type QueuedUserMessage,
  type SessionMessage,
  type SessionSkill,
  type TodoItem,
} from "../../model";
import type { DiffStats } from "../../model/fileDiffs";
import { ModelConfigurationPicker } from "./ModelPicker";
import {
  SessionLocationPicker,
  type SessionLocationPickerProps,
} from "../location/SessionLocationPicker";
import { TodoPopup } from "./TodoPopup";
import { DiffPopup } from "./DiffPopup";
import { SkillPicker } from "./SkillPicker";
import { ArtifactsList } from "./ArtifactsList";
import { VoiceButton } from "./VoiceButton";
import { QueuedMessageList } from "./QueuedMessageList";
import { AttachImageButton, ImageAttachments } from "./ImageAttachments";
import { useImageAttachments } from "./useImageAttachments";
import type { VoiceComposerContext } from "./useVoiceComposer";
import { TypingEffect } from "./typing-effect/TypingEffect";
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
  onSubmit: (message: SessionMessage, options?: { immediate?: true }) => void;
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
  artifacts?: string[];
  queuedMessages?: QueuedMessage[];
  /** Context that grounds a voice call in the current session. */
  sessionName?: string;
  lastMessage?: string;
  /** Persistent Agents are operational mentions only in ordinary and Hyper sessions. */
  enableAgentMentions?: boolean;
  /** Whether newly mentioned agents may begin in an isolated Git worktree. */
  canUseAgentWorktrees?: boolean;
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
  agentMentions: AgentMention[];
  setPrompt: (prompt: string) => void;
  restoreAgentInvitations: (mentions: AgentMention[]) => void;
  resetAfterSubmit: () => void;
  focus: () => void;
};

type ComposerPromptProps = {
  binding: ComposerPromptBinding;
  promptHandle: React.RefObject<ComposerPromptHandle | null>;
  hasAttachments: boolean;
  isStreaming: boolean;
  onStop?: () => void;
  onSubmit: (immediate?: true) => void;
  onRun?: () => void;
  onSend?: () => void;
  onPaste: (event: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  skills?: SessionSkill[];
  showGlobalSkillBadges: boolean;
  // Parent-owned slots retain their element identity while draft text changes.
  leadingControls: React.ReactNode;
  voiceControl: React.ReactNode;
  enableAgentMentions: boolean;
  canUseAgentWorktrees: boolean;
};

function ComposerPrompt({
  binding,
  promptHandle,
  hasAttachments,
  isStreaming,
  onStop,
  onSubmit,
  onRun,
  onSend,
  onPaste,
  skills,
  showGlobalSkillBadges,
  leadingControls,
  voiceControl,
  enableAgentMentions,
  canUseAgentWorktrees,
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
  const { data: agents = [] } = useQuery({
    ...agentQueries.list(),
    enabled: enableAgentMentions,
  });
  const membershipHost = {
    kind: "session" as const,
    sessionId: sessionId ?? "disabled-session",
  };
  const { data: memberships = [] } = useQuery({
    ...agentQueries.membershipList(membershipHost),
    enabled: enableAgentMentions && sessionId !== undefined,
  });
  const [worktreeAgentIds, setWorktreeAgentIds] = useState<Set<string>>(() => new Set());
  const mentionedAgents = findMentionedAgents(prompt, agents);
  const memberAgentIds = new Set(memberships.map(({ agentId }) => agentId));
  const invitations: { agent: Agent; executionMode: AgentExecutionMode }[] = [];
  const agentMentions: AgentMention[] = [];
  for (const agent of mentionedAgents) {
    if (memberAgentIds.has(agent.id)) {
      agentMentions.push({ agentId: agent.id });
      continue;
    }
    const executionMode =
      canUseAgentWorktrees && worktreeAgentIds.has(agent.id) ? "worktree" : "shared";
    invitations.push({ agent, executionMode });
    agentMentions.push({
      agentId: agent.id,
      ...(executionMode === "worktree" ? { initialExecutionMode: "worktree" } : {}),
    });
  }
  const mention = useAgentMentionInput({
    value: prompt,
    onValueChange: onPromptChange,
    textareaRef,
    enabled: enableAgentMentions,
    suggestionsFor: (query) =>
      agentPickerSuggestions({ query, agents, memberships, hostKind: "session" }),
  });
  const isSubmitDisabled = !prompt.trim() && !hasAttachments;
  const submitButtonVariant = isSubmitDisabled ? "ghost" : "accent";
  const submitLabel = isStreaming ? "Queue message" : "Send message";
  const textareaMaxHeightClass = isControlled ? "max-h-36" : "max-h-18";

  useImperativeHandle(promptHandle, () => ({
    prompt,
    agentMentions,
    setPrompt: onPromptChange,
    restoreAgentInvitations: (agentMentions) =>
      setWorktreeAgentIds(
        new Set(
          agentMentions
            .filter(({ initialExecutionMode }) => initialExecutionMode === "worktree")
            .map(({ agentId }) => agentId),
        ),
      ),
    resetAfterSubmit: () => {
      const handles = mentionedAgents.map(({ name }) => `@${agentHandleFromName(name)}`);
      onPromptChange(handles.length > 0 ? `${handles.join(" ")} ` : "");
      if (!isControlled) draft.flush();
      setWorktreeAgentIds(new Set());
    },
    focus: () => textareaRef.current?.focus(),
  }));

  function handleSkillSelect(skill: SessionSkill) {
    onPromptChange(`/${skill.name} `);
    mention.close();
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mention.handleKeyDown(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }

  return (
    <>
      <SkillPicker
        prompt={prompt}
        skills={skills}
        showGlobalSkillBadges={showGlobalSkillBadges}
        onSelect={handleSkillSelect}
      />
      {mention.isOpen && (
        <AgentPicker
          suggestions={mention.suggestions}
          activeIndex={mention.activeIndex}
          onActiveIndexChange={mention.setActiveIndex}
          onSelect={mention.selectSuggestion}
          error={mention.error}
        />
      )}
      <InputGroupTextarea
        ref={textareaRef}
        value={prompt}
        onChange={mention.handleChange}
        onSelect={mention.handleSelect}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        placeholder="Ask a question or describe your idea..."
        className={cn(textareaMaxHeightClass, "min-h-14 overflow-y-auto py-2 text-sm")}
        rows={1}
      />

      <AgentInvitationChips
        invitations={invitations}
        canUseWorktrees={canUseAgentWorktrees}
        onExecutionModeChange={(agentId, mode) =>
          setWorktreeAgentIds((current) => {
            const next = new Set(current);
            if (mode === "worktree") next.add(agentId);
            else next.delete(agentId);
            return next;
          })
        }
      />

      <InputGroupAddon align="block-end" className="relative justify-between pt-0 pb-2">
        <TypingEffect value={prompt} />
        <div className="relative flex items-center gap-1">{leadingControls}</div>

        <div className="relative flex items-center gap-0.5">
          {voiceControl}
          {isStreaming && onStop && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Stop turn"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
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
                        className="w-4 rounded-s-none border-l border-background data-[popup-open]:bg-user-accent/90"
                      />
                    }
                  >
                    <ChevronDown className="h-3 w-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" finalFocus={false}>
                    <DropdownMenuItem onClick={() => onSubmit()}>
                      <ArrowUp />
                      Queue message
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => onSubmit(true)}>
                      <Play />
                      Send immediately
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
                      className="w-4 rounded-s-none data-[popup-open]:bg-user-accent/90"
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
    queuedMessages = [],
    sessionName,
    lastMessage,
    enableAgentMentions = false,
    canUseAgentWorktrees = false,
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

  const {
    attachments,
    isDragging,
    handlePaste,
    fileInputProps,
    openPicker,
    dropTargetProps,
    clearAttachments,
    replaceAttachments,
    removeAttachment,
  } = useImageAttachments();

  useEffect(() => {
    if (!isMobile) promptHandle.current?.focus();
  }, [isMobile]);

  const handleEditQueuedMessage = (message: QueuedUserMessage) => {
    promptHandle.current?.setPrompt(message.content);
    promptHandle.current?.restoreAgentInvitations(message.agentMentions ?? []);
    replaceAttachments(message.attachments ?? []);
    promptHandle.current?.focus();
  };

  const submitWith = (
    submitter: SessionComposerCommonProps["onSubmit"] | undefined,
    immediate?: true,
  ) => {
    const prompt = promptHandle.current?.prompt.trim() ?? "";
    if ((!prompt && attachments.length === 0) || !submitter) return false;
    const agentMentions = promptHandle.current?.agentMentions ?? [];
    submitter(
      {
        content: prompt,
        attachments: attachments.length > 0 ? attachments : undefined,
        agentMentions: agentMentions.length > 0 ? agentMentions : undefined,
      },
      immediate ? { immediate } : undefined,
    );
    promptHandle.current?.resetAfterSubmit();
    clearAttachments();
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
    <form onSubmit={handleSubmit} {...dropTargetProps} className="w-full" suppressHydrationWarning>
      <input {...fileInputProps} suppressHydrationWarning />

      {sessionId && <ArtifactsList sourceSessionId={sessionId} artifacts={artifacts} />}

      {sessionId && (
        <QueuedMessageList
          sessionId={sessionId}
          messages={queuedMessages}
          onEdit={handleEditQueuedMessage}
        />
      )}

      <ImageAttachments attachments={attachments} onRemove={removeAttachment} />

      <div className="relative">
        {isDragging && (
          <div className="absolute inset-0 z-10 rounded-lg bg-blue-500/20 pointer-events-none" />
        )}

        <InputGroup>
          <ComposerPrompt
            key={sessionId ?? "controlled"}
            binding={promptBinding}
            promptHandle={promptHandle}
            hasAttachments={attachments.length > 0}
            isStreaming={isStreaming}
            onStop={onStop}
            onSubmit={submit}
            onRun={createsSession ? () => submitWith(onRun) : undefined}
            onSend={createsSession ? () => submitWith(onSubmit) : undefined}
            onPaste={handlePaste}
            skills={skills}
            showGlobalSkillBadges={showGlobalSkillBadges}
            enableAgentMentions={enableAgentMentions}
            canUseAgentWorktrees={canUseAgentWorktrees}
            leadingControls={
              <>
                <AttachImageButton onClick={openPicker} />

                {locationPicker && <SessionLocationPicker {...locationPicker} />}

                {(models.length === 0 || !model) && <ModelConfigurationSkeleton />}

                {models.length > 0 && model && onModelChange && (
                  <ModelConfigurationPicker
                    models={models}
                    value={model}
                    onValueChange={onModelChange}
                  />
                )}

                <TodoPopup todos={todos} isStreaming={isStreaming} />

                {sessionDiff && <DiffPopup total={sessionDiff.total} byFile={sessionDiff.byFile} />}
              </>
            }
            voiceControl={
              // Stream start unmounts and disconnects session voice; home stays mounted.
              environment.voiceEnabled && !isStreaming ? (
                <VoiceButton context={voiceContext} />
              ) : null
            }
          />
        </InputGroup>
      </div>
    </form>
  );
}
