import { useRef, useEffect, useState, useCallback, useMemo, memo } from "react";
import { Image, ArrowUp, Pencil, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@/components/ui/input-group";
import { ModelPicker } from "./ModelPicker";
import { SessionDirectoryPicker } from "../SessionDirectoryPicker";
import type { SessionDirectoryOption } from "../sessionDirectoryOptions";
import { TodoPopup } from "./TodoPopup";
import { DiffPopup } from "./DiffPopup";
import type { Attachment, ModelInfo, QueuedMessage, TodoItem } from "@/types";
import { toDataUrl } from "@/types";
import type { FileDiff, LineDiff } from "@/hooks/diffs/useEditDiffs";
import { useViewport } from "@/hooks/browser/ViewportContext";

const TEXTAREA_MIN_HEIGHT = 40;
const TEXTAREA_MAX_HEIGHT = 72;

export interface SessionInputProps {
  onSubmit: (text: string, attachments: Attachment[]) => void;
  isStreaming: boolean;
  onStop: () => void;
  models?: ModelInfo[];
  selectedModel?: string;
  onModelChange?: (modelId: string) => void;
  directoryOptions?: SessionDirectoryOption[];
  selectedDirectory?: string;
  selectedRepository?: string;
  selectedGitRoot?: string;
  onDirectoryChange?: (directory: string) => void;
  directoryPickerDisabled?: boolean;
  showDirectoryPicker?: boolean;
  todos?: TodoItem[];
  sessionDiff?: { total: LineDiff; byFile: FileDiff[] };
  queuedMessages?: QueuedMessage[];
  onCancelQueuedMessage?: (queuedMessageId: string) => void;
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

export const SessionInput = memo(function SessionInput({
  onSubmit,
  isStreaming,
  onStop,
  models,
  selectedModel,
  onModelChange,
  directoryOptions = [],
  selectedDirectory,
  selectedRepository,
  selectedGitRoot,
  onDirectoryChange,
  directoryPickerDisabled = false,
  showDirectoryPicker = true,
  todos,
  sessionDiff,
  queuedMessages = [],
  onCancelQueuedMessage,
}: SessionInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { isMobile } = useViewport();

  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Focus input on desktop only (avoids mobile scroll/viewport jumps)
  useEffect(() => {
    if (!isMobile) {
      textareaRef.current?.focus();
    }
  }, [isMobile]);

  const handleEditQueuedMessage = useCallback(
    (queuedMessageId: string) => {
      const message = queuedMessages.find((m) => m.id === queuedMessageId);
      if (!message) return;
      onCancelQueuedMessage?.(queuedMessageId);
      setInput(message.content);
      textareaRef.current?.focus();
    },
    [queuedMessages, onCancelQueuedMessage],
  );

  // Auto-resize textarea as content changes
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    if (!input.trim()) {
      textarea.style.height = `${TEXTAREA_MIN_HEIGHT}px`;
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
  }, [input]);

  const handleImageClick = () => {
    fileInputRef.current?.click();
  };

  const processImageFile = useCallback((file: File, fallbackName = "image.png") => {
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(",")[1];
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
  }, []);

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

  const handleRemoveAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() && attachments.length === 0) return;
    onSubmit(input.trim(), attachments);
    setInput("");
    setAttachments([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
  }, []);

  const dragHandlers = useMemo(
    () => ({
      onDragEnter: (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        e.preventDefault();
        const relatedTarget = e.relatedTarget as Node | null;
        if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
          setIsDragging(false);
        }
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) processImageFile(file, "dropped-image.png");
      },
    }),
    [processImageFile],
  );

  return (
    <form onSubmit={handleSubmit} className="w-full" suppressHydrationWarning {...dragHandlers}>
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
        suppressHydrationWarning
      />

      {/* Queued messages */}
      {queuedMessages.length > 0 && (
        <div className="mb-3 space-y-2">
          {queuedMessages.map((message) => (
            <div
              key={message.id}
              className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground group"
            >
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 rounded-full md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                onClick={() => handleEditQueuedMessage(message.id)}
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <span className="truncate flex-1">{message.content}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-5 w-5 shrink-0 rounded-full md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                onClick={() => onCancelQueuedMessage?.(message.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <AttachmentPreview attachments={attachments} onRemove={handleRemoveAttachment} />

      <div className="relative">
        {/* Drop zone overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-10 rounded-lg bg-blue-500/20 pointer-events-none" />
        )}

        <InputGroup>
          <InputGroupTextarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder="Ask a question or describe your idea..."
            className="min-h-[40px] max-h-[72px] overflow-y-auto py-2 text-sm"
            rows={1}
          />

          <InputGroupAddon align="block-end" className="justify-between pt-0 pb-2">
            {/* Left side: image, model picker, todo icon */}
            <div className="flex items-center gap-1">
              <InputGroupButton
                size="icon-xs"
                aria-label="Attach image"
                onClick={handleImageClick}
                suppressHydrationWarning
              >
                <Image className="h-4 w-4" />
              </InputGroupButton>

              {showDirectoryPicker && (
                <SessionDirectoryPicker
                  value={selectedDirectory}
                  repository={selectedRepository}
                  gitRoot={selectedGitRoot}
                  options={directoryOptions}
                  onValueChange={onDirectoryChange}
                  disabled={directoryPickerDisabled}
                />
              )}

              {models && onModelChange && (
                <ModelPicker
                  models={models}
                  selectedModel={selectedModel}
                  onModelChange={onModelChange}
                />
              )}

              <TodoPopup todos={todos} isStreaming={isStreaming} />

              {sessionDiff && <DiffPopup total={sessionDiff.total} byFile={sessionDiff.byFile} />}
            </div>

            {/* Right side: stop and send buttons */}
            <div className="flex items-center gap-0.5">
              {isStreaming && (
                <InputGroupButton
                  size="icon-xs"
                  aria-label="Stop"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={onStop}
                  suppressHydrationWarning
                >
                  <Square className="h-4 w-4" />
                </InputGroupButton>
              )}
              <InputGroupButton
                type="submit"
                size="icon-xs"
                aria-label="Send"
                disabled={!input.trim() && attachments.length === 0}
                suppressHydrationWarning
              >
                <ArrowUp className="h-4 w-4" />
              </InputGroupButton>
            </div>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </form>
  );
});
