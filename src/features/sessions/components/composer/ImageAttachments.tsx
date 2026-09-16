import { Image, X } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import { InputGroupButton } from "@/shared/components/ui/input-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/components/ui/tooltip";
import { toDataUrl, type Attachment } from "../../model";

export function ImageAttachments({
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
          // eslint-disable-next-line react/no-array-index-key -- stateless previews may contain the same image more than once
          key={index}
          className="inline-flex items-center gap-1.5 rounded-md border bg-secondary-background p-1.5"
        >
          <img
            src={toDataUrl(attachment)}
            alt={`Image ${index + 1}`}
            className="h-8 w-8 rounded object-cover"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove image ${index + 1}`}
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

export function AttachImageButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <InputGroupButton
            size="icon-xs"
            aria-label="Attach image"
            onClick={onClick}
            suppressHydrationWarning
          >
            <Image className="h-4 w-4" />
          </InputGroupButton>
        }
      />
      <TooltipContent sideOffset={6}>Attach image</TooltipContent>
    </Tooltip>
  );
}
