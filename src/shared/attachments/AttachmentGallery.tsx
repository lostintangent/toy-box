import { useRef, useState, type ReactNode } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { ChevronLeft, ChevronRight, ImageIcon, X } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { Carousel, useCarousel } from "motion-plus/react";
import { Button } from "@/shared/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogTrigger } from "@/shared/ui/dialog";
import { cn } from "@/shared/utils";
import type { Attachment } from "./model";

const attachmentPillClassName =
  "inline-flex h-7 max-w-48 shrink-0 items-center gap-1.5 rounded-md border bg-background px-1 text-xs text-muted-foreground";

/** Presents an attachment collection and opens any image in the shared viewer. */
export function AttachmentGallery({
  attachments,
  variant = "thumbnails",
  onRemove,
}: {
  attachments: readonly (Attachment | { label: string; src: string })[];
  variant?: "pills" | "thumbnails" | "summary";
  onRemove?: (index: number) => void;
}) {
  const previews = attachments.map((attachment, index) => ({
    label: "src" in attachment ? attachment.label : `Image ${index + 1}`,
    src: "src" in attachment ? attachment.src : toDataUrl(attachment),
  }));
  const images = previews.filter((preview) => preview.src !== undefined);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [pillKey] = useState(() => {
    const keys = new WeakMap<object, number>();
    let nextKey = 0;
    return (attachment: object) => {
      let key = keys.get(attachment);
      if (key === undefined) {
        key = nextKey;
        nextKey += 1;
        keys.set(attachment, key);
      }
      return key;
    };
  });
  const dialogRef = useRef<HTMLDivElement>(null);

  const trigger = (index: number, className: string, children: ReactNode) => {
    const preview = previews[index]!;
    return (
      <DialogTrigger
        key={index}
        type="button"
        disabled={!preview.src}
        onClick={() => setSelectedIndex(Math.max(0, images.indexOf(preview)))}
        aria-label={`Preview ${variant === "summary" ? "images" : preview.label}`}
        className={className}
      >
        {children}
      </DialogTrigger>
    );
  };
  const thumbnail = (index: number, className: string) => {
    const { label, src } = previews[index]!;
    return src ? (
      <img src={src} alt={label} className={cn("object-cover", className)} />
    ) : (
      <ImageIcon className={cn("text-muted-foreground", className)} />
    );
  };

  return (
    <Dialog>
      {variant === "summary" && previews.length > 0 ? (
        trigger(
          0,
          "inline-flex h-5 shrink-0 items-center gap-1 rounded border bg-background px-1 text-2xs text-muted-foreground hover:text-foreground",
          <>
            {thumbnail(0, "size-3 rounded-[2px]")}
            {previews.length} {previews.length === 1 ? "image" : "images"}
          </>,
        )
      ) : variant === "pills" ? (
        <AnimatePresence initial={false} mode="popLayout">
          {previews.map((preview, index) => (
            <m.span
              key={pillKey(attachments[index]!)}
              layout="position"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className={attachmentPillClassName}
            >
              {trigger(
                index,
                "flex min-w-0 items-center gap-1.5",
                <>
                  {thumbnail(index, "size-5 shrink-0 rounded-sm")}
                  <span className="truncate">{preview.label}</span>
                </>,
              )}
              {onRemove && (
                <button
                  type="button"
                  aria-label={`Remove ${preview.label.toLowerCase()}`}
                  className="rounded-sm p-0.5 hover:bg-accent/50 hover:text-foreground"
                  onClick={() => onRemove(index)}
                >
                  <X className="size-3" />
                </button>
              )}
            </m.span>
          ))}
        </AnimatePresence>
      ) : (
        previews.map((preview, index) =>
          trigger(
            index,
            cn(
              "flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-muted transition-colors",
              preview.src && "hover:border-accent",
            ),
            thumbnail(index, preview.src ? "size-full" : "size-5"),
          ),
        )
      )}
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
            items={images.map(({ label, src }, index) => (
              <DialogClose
                // eslint-disable-next-line react/no-array-index-key -- each occurrence in the immutable message has its own carousel position
                key={index}
                type="button"
                aria-label={`Close preview of ${label}`}
                className="flex size-full items-center justify-center"
              >
                <img
                  src={src}
                  alt={label}
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
  images: { label: string }[];
  hotkeyTarget: React.RefObject<HTMLDivElement | null>;
}) {
  const { currentPage, totalPages, nextPage, prevPage, isNextActive, isPrevActive } = useCarousel();
  const selectedImage = images[currentPage] ?? images[0]!;

  useHotkey("ArrowLeft", prevPage, { target: hotkeyTarget });
  useHotkey("ArrowRight", nextPage, { target: hotkeyTarget });

  return (
    <>
      <DialogTitle className="sr-only">{selectedImage.label}</DialogTitle>
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
            className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground"
          >
            {currentPage + 1} of {totalPages}
          </span>
        </>
      )}
    </>
  );
}

function toDataUrl(attachment: Attachment): string | undefined {
  return attachment.base64 ? `data:${attachment.mimeType};base64,${attachment.base64}` : undefined;
}
