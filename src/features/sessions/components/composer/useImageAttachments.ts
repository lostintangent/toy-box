import { useRef, useState } from "react";
import type { Attachment } from "../../model";

/** Browser-local image selection shared by message composers. */
export function useImageAttachments() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  function attachImage(file: File, fallbackName = "image.png") {
    if (!file.type.startsWith("image/")) return;

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") return;
      const base64 = reader.result.split(",")[1];
      if (!base64) return;
      setAttachments((current) => [
        ...current,
        {
          displayName: file.name || fallbackName,
          base64,
          mimeType: file.type,
        },
      ]);
    };
    reader.readAsDataURL(file);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) attachImage(file);
    event.target.value = "";
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    for (const item of event.clipboardData?.items ?? []) {
      if (!item.type.startsWith("image/")) continue;
      event.preventDefault();
      const file = item.getAsFile();
      if (file) attachImage(file, "pasted-image.png");
      return;
    }
  }

  return {
    attachments,
    isDragging,
    handlePaste,
    fileInputProps: {
      ref: fileInputRef,
      type: "file" as const,
      accept: "image/*",
      className: "hidden",
      onChange: handleFileChange,
    },
    openPicker: () => fileInputRef.current?.click(),
    dropTargetProps: {
      onDragEnter(event: React.DragEvent) {
        event.preventDefault();
        setIsDragging(true);
      },
      onDragLeave(event: React.DragEvent) {
        event.preventDefault();
        const relatedTarget = event.relatedTarget as Node | null;
        if (!relatedTarget || !event.currentTarget.contains(relatedTarget)) setIsDragging(false);
      },
      onDragOver(event: React.DragEvent) {
        event.preventDefault();
      },
      onDrop(event: React.DragEvent) {
        event.preventDefault();
        setIsDragging(false);
        const file = event.dataTransfer.files[0];
        if (file) attachImage(file, "dropped-image.png");
      },
    },
    clearAttachments: () => setAttachments([]),
    replaceAttachments: setAttachments,
    removeAttachment: (index: number) =>
      setAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index)),
  };
}
