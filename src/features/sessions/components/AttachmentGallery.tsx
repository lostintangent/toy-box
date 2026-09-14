import { useRef, useState } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { ChevronLeft, ChevronRight, ImageIcon } from "lucide-react";
import { Carousel, useCarousel } from "motion-plus/react";
import { machineFile } from "@files/model";
import { createFileServeUrl, getPathBasename } from "@files/model/paths";
import { Button } from "@/shared/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { cn } from "@/shared/utils";
import { toDataUrl, type Attachment } from "../model";

const thumbnailSizeClasses = {
  compact: "size-8",
  default: "size-12",
} as const;

export function AttachmentGallery({
  attachments,
  size = "default",
}: {
  attachments: readonly (Attachment | string)[];
  size?: keyof typeof thumbnailSizeClasses;
}) {
  const previews = attachments.map((attachment) => ({
    displayName:
      typeof attachment === "string" ? getPathBasename(attachment) : attachment.displayName,
    dataUrl:
      typeof attachment === "string"
        ? createFileServeUrl(machineFile(attachment))
        : attachment.mimeType.startsWith("image/")
          ? toDataUrl(attachment)
          : undefined,
  }));
  const images = previews.filter((preview) => preview.dataUrl !== undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);

  return (
    <Dialog>
      {previews.map((preview) => {
        const { displayName, dataUrl } = preview;
        const imageIndex = images.findIndex((image) => image === preview);
        return (
          <DialogTrigger
            key={dataUrl ?? displayName}
            type="button"
            disabled={!dataUrl}
            onClick={() => setSelectedIndex(imageIndex)}
            aria-label={`Preview ${displayName}`}
            data-long-press-ignore
            className={cn(
              thumbnailSizeClasses[size],
              "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted transition-colors",
              dataUrl && "hover:border-primary",
            )}
          >
            {dataUrl ? (
              <img src={dataUrl} alt={displayName} className="size-full object-cover" />
            ) : (
              <ImageIcon className="size-5 text-muted-foreground" />
            )}
          </DialogTrigger>
        );
      })}
      {images.length > 0 && (
        <DialogContent
          ref={dialogRef}
          initialFocus={dialogRef}
          aria-describedby={undefined}
          className="h-[85vh] w-[90vw] max-w-5xl border-0 bg-transparent p-0 sm:max-w-5xl"
          showCloseButton={false}
        >
          <Carousel
            aria-label="Message attachments"
            className="size-full"
            items={images.map(({ displayName, dataUrl }) => (
              <DialogClose
                key={dataUrl}
                type="button"
                aria-label={`Close preview of ${displayName}`}
                className="flex size-full items-center justify-center"
              >
                <img
                  src={dataUrl}
                  alt={displayName}
                  draggable={false}
                  className="max-h-full max-w-full rounded-lg object-contain select-none"
                />
              </DialogClose>
            ))}
            itemSize="fill"
            align="stretch"
            gap={0}
            loop={false}
            page={selectedIndex}
          >
            <AttachmentCarouselControls images={images} hotkeyTarget={dialogRef} />
          </Carousel>
        </DialogContent>
      )}
    </Dialog>
  );
}

function AttachmentCarouselControls({
  images,
  hotkeyTarget,
}: {
  images: { displayName: string }[];
  hotkeyTarget: React.RefObject<HTMLDivElement | null>;
}) {
  const { currentPage, totalPages, nextPage, prevPage, isNextActive, isPrevActive } = useCarousel();
  const selectedImage = images[currentPage] ?? images[0]!;

  useHotkey("ArrowLeft", prevPage, { target: hotkeyTarget });
  useHotkey("ArrowRight", nextPage, { target: hotkeyTarget });

  return (
    <>
      <DialogTitle className="sr-only">{selectedImage.displayName}</DialogTitle>
      {totalPages > 1 && (
        <>
          <Button
            type="button"
            variant="accent"
            size="icon"
            aria-label="Previous image"
            disabled={!isPrevActive}
            className="absolute top-1/2 left-2 -translate-y-1/2 rounded-full shadow-md sm:-left-12"
            onClick={prevPage}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="accent"
            size="icon"
            aria-label="Next image"
            disabled={!isNextActive}
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full shadow-md sm:-right-12"
            onClick={nextPage}
          >
            <ChevronRight />
          </Button>
          <span
            aria-live="polite"
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-user-accent px-2 py-0.5 text-xs text-user-accent-foreground"
          >
            {currentPage + 1} of {totalPages}
          </span>
        </>
      )}
    </>
  );
}
