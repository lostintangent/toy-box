import { useEffect, useRef, useState } from "react";
import type { Attachment } from "@/shared/attachments/model";

/** Owns the images being assembled for one composer draft. */
export function useAttachments() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const [items, setItems] = useState<Attachment[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(
    () => () => {
      generation.current += 1;
    },
    [],
  );

  function append(attachments: readonly Attachment[]) {
    if (attachments.length > 0) setItems((current) => [...current, ...attachments]);
  }

  function attachFiles(files: Iterable<File>) {
    const images = [...files].filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return false;

    const currentGeneration = generation.current;
    setPendingCount((count) => count + images.length);
    void Promise.all(images.map(readAttachment)).then((results) => {
      if (generation.current !== currentGeneration) return;
      setPendingCount((count) => count - images.length);
      append(results.filter((attachment) => attachment !== undefined));
    });
    return true;
  }

  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    if (attachFiles(event.clipboardData.files)) event.preventDefault();
  }

  function clear() {
    generation.current += 1;
    setItems([]);
    setPendingCount(0);
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return {
    items,
    pendingCount,
    isDragging,
    append,
    remove: (index: number) =>
      setItems((current) => current.filter((_, position) => position !== index)),
    removeLast: () => setItems((current) => current.slice(0, -1)),
    clear,
    handlePaste,
    fileInputProps: {
      ref: fileInputRef,
      type: "file" as const,
      accept: "image/*",
      multiple: true,
      className: "hidden",
      onChange(event: React.ChangeEvent<HTMLInputElement>) {
        attachFiles(event.target.files ?? []);
        event.target.value = "";
      },
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
        attachFiles(event.dataTransfer.files);
      },
    },
  };
}

function readAttachment(file: File): Promise<Attachment | undefined> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = typeof reader.result === "string" ? reader.result.split(",")[1] : undefined;
      resolve(base64 ? { base64, mimeType: file.type } : undefined);
    };
    reader.onerror = () => resolve(undefined);
    reader.onabort = () => resolve(undefined);
    reader.readAsDataURL(file);
  });
}
