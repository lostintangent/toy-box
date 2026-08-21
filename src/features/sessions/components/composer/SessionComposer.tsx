// Shared composer for session delivery and Inbox creation. Session ID
// presence is the complete host discriminator.

import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Image, ArrowUp, ChevronDown, Play, Square, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
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
  toDataUrl,
  type Attachment,
  type ModelInfo,
  type QueuedMessage,
  type QueuedUserMessage,
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
import type { VoiceComposerContext } from "./useVoiceComposer";
import { useWorkspaceSelector } from "@workspace/hooks/state";
import { useDraftPrompt } from "../../useDraftPrompt";
import type { FileDiffSummary } from "../transcript/editDiffs";
import { useViewport } from "@/shared/hooks/useViewport";
import { cn } from "@/shared/utils";

type SessionComposerSubmit = (prompt: string, attachments: Attachment[], immediate?: true) => void;

type ComposerPromptBinding =
  | { sessionId: string }
  | {
      prompt: string;
      onPromptChange: (prompt: string) => void;
    };

type SessionComposerCommonProps = {
  onSubmit: SessionComposerSubmit;
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
        onRun: SessionComposerSubmit;
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

function AttachmentPreview({
  attachments,
  onRemove,
}: {
  attachments: Attachment[];
  onRemove: (index: number) => void;
}) {
  if (attachments.length === 0) return null;

  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attachments.map((attachment, index) => (
        <div
          key={attachment.base64}
          className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 p-1.5"
        >
          <img
            src={toDataUrl(attachment)}
            alt={attachment.displayName}
            className="h-8 w-8 rounded object-cover"
          />
          <span className="text-xs text-muted-foreground truncate max-w-25">
            {attachment.displayName}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove ${attachment.displayName}`}
            className="h-5 w-5 rounded-full"
            onClick={() => onRemove(index)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      ))}
    </div>
  );
}

type ComposerPromptHandle = {
  prompt: string;
  setPrompt: (prompt: string) => void;
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
  const isSubmitDisabled = !prompt.trim() && !hasAttachments;
  const submitButtonVariant = isSubmitDisabled ? "ghost" : "accent";
  const submitLabel = isStreaming ? "Queue message" : "Send message";
  const textareaSizeClass = isControlled ? "min-h-20 max-h-36" : "min-h-10 max-h-18";

  useImperativeHandle(
    promptHandle,
    () => ({
      prompt,
      setPrompt: onPromptChange,
      focus: () => textareaRef.current?.focus(),
    }),
    [onPromptChange, prompt],
  );

  function handleSkillSelect(skill: SessionSkill) {
    onPromptChange(`/${skill.name} `);
    textareaRef.current?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
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
      <InputGroupTextarea
        ref={textareaRef}
        value={prompt}
        onChange={(event) => onPromptChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={onPaste}
        placeholder="Ask a question or describe your idea..."
        className={cn(textareaSizeClass, "overflow-y-auto py-2 text-sm")}
        rows={1}
      />

      <InputGroupAddon align="block-end" className="justify-between pt-0 pb-2">
        <div className="flex items-center gap-1">{leadingControls}</div>

        <div className="flex items-center gap-0.5">
          {voiceControl}
          {isStreaming && onStop && (
            <Tooltip>
              <TooltipTrigger asChild>
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Stop turn"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={onStop}
                  suppressHydrationWarning
                >
                  <Square className="h-4 w-4" />
                </InputGroupButton>
              </TooltipTrigger>
              <TooltipContent sideOffset={6}>Stop turn</TooltipContent>
            </Tooltip>
          )}
          {!isControlled ? (
            <div className="flex">
              <Tooltip>
                <TooltipTrigger asChild>
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
                </TooltipTrigger>
                <TooltipContent sideOffset={6}>{submitLabel}</TooltipContent>
              </Tooltip>
              {isStreaming && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <InputGroupButton
                      size="icon-xs"
                      aria-label="Message delivery options"
                      disabled={isSubmitDisabled}
                      variant={submitButtonVariant}
                      suppressHydrationWarning
                      className="w-4 rounded-s-none border-l border-background data-[state=open]:bg-user-accent/90"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </InputGroupButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    onCloseAutoFocus={(event) => event.preventDefault()}
                  >
                    <DropdownMenuItem onSelect={() => onSubmit()}>
                      <ArrowUp />
                      Queue message
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => onSubmit(true)}>
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
                <DropdownMenuTrigger asChild>
                  <InputGroupButton
                    size="icon-xs"
                    aria-label="Run options"
                    disabled={isSubmitDisabled}
                    variant={submitButtonVariant}
                    suppressHydrationWarning
                    className="w-4 rounded-s-none data-[state=open]:bg-user-accent/90"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </InputGroupButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  // Let submission's textarea focus stand instead of
                  // returning focus to the chevron trigger.
                  onCloseAutoFocus={(event) => event.preventDefault()}
                >
                  <DropdownMenuItem onSelect={onRun}>
                    <Play />
                    <div className="flex flex-col">
                      <span>Run</span>
                      <span className="text-xs text-muted-foreground">
                        Sends the result to Inbox
                      </span>
                    </div>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onSend}>
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
  } = props;
  const promptHandle = useRef<ComposerPromptHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isMobile) promptHandle.current?.focus();
  }, [isMobile]);

  const handleEditQueuedMessage = (message: QueuedUserMessage) => {
    promptHandle.current?.setPrompt(message.content);
    setAttachments(message.attachments ?? []);
    promptHandle.current?.focus();
  };

  const processImageFile = (file: File, fallbackName = "image.png") => {
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
      if (!base64) return;

      setAttachments((prev) => [
        ...prev,
        {
          displayName: file.name || fallbackName,
          base64,
          mimeType: file.type,
        },
      ]);
    };
    reader.readAsDataURL(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processImageFile(file);
    e.target.value = "";
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    for (const item of e.clipboardData?.items ?? []) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processImageFile(file, "pasted-image.png");
        return;
      }
    }
  };

  const submitWith = (submitter: SessionComposerSubmit | undefined, immediate?: true) => {
    const prompt = promptHandle.current?.prompt.trim() ?? "";
    if ((!prompt && attachments.length === 0) || !submitter) return false;
    submitter(prompt, attachments, immediate);
    promptHandle.current?.setPrompt("");
    setAttachments([]);
    promptHandle.current?.focus();
    return true;
  };

  const submit = (immediate?: true) => submitWith(createsSession ? onRun : onSubmit, immediate);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    const relatedTarget = e.relatedTarget as Node | null;
    if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) processImageFile(file, "dropped-image.png");
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
      onDragEnter={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={handleDragLeave}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="w-full"
      suppressHydrationWarning
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        suppressHydrationWarning
      />

      {sessionId && <ArtifactsList sourceSessionId={sessionId} artifacts={artifacts} />}

      {sessionId && (
        <QueuedMessageList
          sessionId={sessionId}
          messages={queuedMessages}
          onEdit={handleEditQueuedMessage}
        />
      )}

      <AttachmentPreview
        attachments={attachments}
        onRemove={(index) => setAttachments((current) => current.filter((_, i) => i !== index))}
      />

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
            leadingControls={
              <>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <InputGroupButton
                      size="icon-xs"
                      aria-label="Attach image"
                      onClick={() => fileInputRef.current?.click()}
                      suppressHydrationWarning
                    >
                      <Image className="h-4 w-4" />
                    </InputGroupButton>
                  </TooltipTrigger>
                  <TooltipContent sideOffset={6}>Attach image</TooltipContent>
                </Tooltip>

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
