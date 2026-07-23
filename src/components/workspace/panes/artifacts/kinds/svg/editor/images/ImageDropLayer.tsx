import { useLayoutEffect, useState, type RefObject } from "react";
import { useSelector } from "@tanstack/react-store";
import type { EditorStore } from "../../store";
import { insertImageFile } from "./images";

export function ImageDropLayer({
  store,
  viewportRef,
}: {
  store: EditorStore;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const readOnly = useSelector(store, (state) => state.readOnly);
  const [draggingImage, setDraggingImage] = useState(false);

  useLayoutEffect(() => {
    if (readOnly) return;
    const viewport = viewportRef.current;
    if (!viewport) return;

    function handleDragOver(event: DragEvent) {
      if (!hasImageFile(event.dataTransfer)) return;

      event.preventDefault();
      event.dataTransfer!.dropEffect = "copy";
      setDraggingImage(true);
    }

    function handleDragLeave(event: DragEvent) {
      if (event.relatedTarget instanceof Node && viewport!.contains(event.relatedTarget)) return;

      setDraggingImage(false);
    }

    function handleDrop(event: DragEvent) {
      if (!event.dataTransfer) return;

      const image = Array.from(event.dataTransfer.files).find((file) =>
        file.type.startsWith("image/"),
      );
      if (!image) return;

      event.preventDefault();
      event.stopPropagation();

      setDraggingImage(false);
      void insertImageFile(store, image);
    }

    viewport.addEventListener("dragover", handleDragOver);
    viewport.addEventListener("dragleave", handleDragLeave);
    viewport.addEventListener("drop", handleDrop);

    return () => {
      viewport.removeEventListener("dragover", handleDragOver);
      viewport.removeEventListener("dragleave", handleDragLeave);
      viewport.removeEventListener("drop", handleDrop);
    };
  }, [readOnly, store, viewportRef]);

  return !readOnly && draggingImage ? (
    <div className="pointer-events-none absolute inset-0 z-[35] bg-accent/40" />
  ) : null;
}

function hasImageFile(dataTransfer: DataTransfer | null): boolean {
  return Boolean(
    dataTransfer &&
    Array.from(dataTransfer.items).some(
      (item) => item.kind === "file" && item.type.startsWith("image/"),
    ),
  );
}
