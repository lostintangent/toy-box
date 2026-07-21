// Shared input for session delivery and Inbox creation. Session ID
// presence is the complete host discriminator.

import { useRef, useEffect, useState } from "react";
import { Image, ArrowUp, ChevronDown, Play, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ModelConfigurationPicker } from "./ModelPicker";
import {
  SessionLocationPicker,
  type SessionLocationPickerProps,
} from "@/components/workspace/panes/session/location/SessionLocationPicker";
import { TodoPopup } from "./TodoPopup";
import { DiffPopup } from "./DiffPopup";
import { SkillPicker } from "./SkillPicker";
import { ArtifactsList } from "./ArtifactsList";
import { VoiceButton } from "./VoiceButton";
import { QueuedMessageRow } from "./QueuedMessageRow";
import type { VoiceComposerContext } from "./useVoiceComposer";
import { useWorkspaceSelector } from "@/hooks/workspace/state";
import type {
  Attachment,
  ModelConfiguration,
  ModelInfo,
  QueuedMessage,
  SessionSkill,
  TodoItem,
} from "@/types";
import { toDataUrl } from "@/types";
import type { DiffStats, FileDiffSummary } from "@/hooks/diffs/useEditDiffs";
import { useViewport } from "@/hooks/browser/useViewport";
import { cn } from "@/lib/utils";

// Pixel bounds mirror the Tailwind min/max height classes on the textarea.
const TEXTAREA_BOUNDS = {
  session: { min: 40, max: 72, className: "min-h-10 max-h-18" },
  create: { min: 80, max: 144, className: "min-h-20 max-h-36" },
} as const;

type SessionComposerSubmit = (text: string, attachments: Attachment[]) => void;

type SessionComposerProps = {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: SessionComposerSubmit;
  canSubmit?: boolean;
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
  onCancelQueuedMessage?: (queuedMessageId: string) => Promise<boolean>;
  onSteerQueuedMessage?: (queuedMessageId: string) => Promise<boolean>;
  /** Context that grounds a voice call in the current session. */
  sessionName?: string;
  lastMessage?: string;
} & (
  | {
      /** Identifies the existing session that receives onSubmit. */
      sessionId: string;
      onRun?: never;
    }
  | {
      sessionId?: undefined;
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

export function SessionComposer({
  sessionId,
  value,
  onValueChange,
  onSubmit,
  onRun,
  canSubmit = true,
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
  onCancelQueuedMessage,
  onSteerQueuedMessage,
  sessionName,
  lastMessage,
}: SessionComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = useViewport();
  const environment = useWorkspaceSelector((workspace) => workspace.environment);
  const createsSession = sessionId === undefined;
  const textareaBounds = TEXTAREA_BOUNDS[createsSession ? "create" : "session"];

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isMobile) textareaRef.current?.focus();
  }, [isMobile]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!value.trim()) {
      textarea.style.height = `${textareaBounds.min}px`;
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, textareaBounds.max)}px`;
  }, [value, textareaBounds]);

  const handleSkillSelect = (skill: SessionSkill) => {
    onValueChange(`/${skill.name} `);
    textareaRef.current?.focus();
  };

  const handleEditQueuedMessage = async (queuedMessageId: string) => {
    const message = queuedMessages.find((candidate) => candidate.id === queuedMessageId);
    if (!message || message.role !== "user") return;
    if (!(await onCancelQueuedMessage?.(queuedMessageId))) return;
    onValueChange(message.content);
    setAttachments(message.attachments ?? []);
    textareaRef.current?.focus();
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

  const handlePaste = (e: React.ClipboardEvent) => {
    for (const item of e.clipboardData?.items ?? []) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) processImageFile(file, "pasted-image.png");
        return;
      }
    }
  };

  const isSubmitDisabled = !canSubmit || (!value.trim() && attachments.length === 0);
  const submitButtonVariant = isSubmitDisabled ? "ghost" : "accent";

  const submitWith = (submitter: SessionComposerSubmit | undefined) => {
    if (isSubmitDisabled || !submitter) return false;
    submitter(value.trim(), attachments);
    onValueChange("");
    setAttachments([]);
    textareaRef.current?.focus();
    return true;
  };

  const submit = () => submitWith(createsSession ? onRun : onSubmit);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
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
    prompt: value,
    models,
    model: model ?? null,
    setPrompt: onValueChange,
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

      {queuedMessages.length > 0 && (
        <div className="mb-3 space-y-2">
          {queuedMessages.map((message) => (
            <QueuedMessageRow
              key={message.id}
              message={message}
              onEdit={handleEditQueuedMessage}
              onCancel={onCancelQueuedMessage}
              onSteer={onSteerQueuedMessage}
            />
          ))}
        </div>
      )}

      <AttachmentPreview
        attachments={attachments}
        onRemove={(index) => setAttachments((current) => current.filter((_, i) => i !== index))}
      />

      <div className="relative">
        {isDragging && (
          <div className="absolute inset-0 z-10 rounded-lg bg-blue-500/20 pointer-events-none" />
        )}

        <SkillPicker
          input={value}
          skills={skills}
          showGlobalSkillBadges={showGlobalSkillBadges}
          onSelect={handleSkillSelect}
        >
          <InputGroup>
            <InputGroupTextarea
              ref={textareaRef}
              value={value}
              onChange={(e) => onValueChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Ask a question or describe your idea..."
              className={cn(textareaBounds.className, "overflow-y-auto py-2 text-sm")}
              rows={1}
            />

            <InputGroupAddon align="block-end" className="justify-between pt-0 pb-2">
              <div className="flex items-center gap-1">
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
              </div>

              <div className="flex items-center gap-0.5">
                {/* Stream start unmounts and disconnects session voice; home stays mounted. */}
                {environment.voiceEnabled && !isStreaming && <VoiceButton context={voiceContext} />}
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
                {!createsSession ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <InputGroupButton
                        type="submit"
                        size="icon-xs"
                        aria-label="Send message"
                        disabled={isSubmitDisabled}
                        variant={submitButtonVariant}
                        suppressHydrationWarning
                      >
                        <ArrowUp className="h-4 w-4" />
                      </InputGroupButton>
                    </TooltipTrigger>
                    <TooltipContent sideOffset={6}>Send message</TooltipContent>
                  </Tooltip>
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
                        // Let submit()'s textarea focus stand instead of
                        // returning focus to the chevron trigger.
                        onCloseAutoFocus={(event) => event.preventDefault()}
                      >
                        <DropdownMenuItem onSelect={() => submitWith(onRun)}>
                          <Play />
                          <div className="flex flex-col">
                            <span>Run</span>
                            <span className="text-xs text-muted-foreground">
                              Sends the result to Inbox
                            </span>
                          </div>
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => submitWith(onSubmit)}>
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
          </InputGroup>
        </SkillPicker>
      </div>
    </form>
  );
}
