import { ExternalLink, MonitorPlay } from "lucide-react";
import { useRouter } from "@tanstack/react-router";
import type { Preview } from "@/shared/preview";
import { useViewport } from "@/shared/hooks/useViewport";
import { ScreenPreview } from "@screens/client/ScreenPreview";
import { createScreenPane } from "@screens/model";
import { useWorkspaceSurface } from "@workspace/hooks/layout/surface";
import { PreviewCard, PreviewCardContent, PreviewCardTrigger } from "@/shared/ui/preview-card";
import { buttonVariants } from "@/shared/ui/button";
import { cn } from "@/shared/utils";
import { PagePreview } from "./PagePreview";
import { outputPillClassName } from "./ArtifactPill";

export function WorkspacePreview({
  preview,
  variant = "pill",
  onOpen,
}: {
  preview: Preview;
  variant?: "pill" | "row" | "inline";
  onOpen?: () => void;
}) {
  const surface = useWorkspaceSurface();
  const router = useRouter();
  const { isMobile } = useViewport();
  const target =
    preview.kind === "url"
      ? {
          href: preview.url,
          label: preview.url,
          ariaLabel: undefined,
          content: <PagePreview src={preview.url} title={`Preview ${preview.url}`} />,
        }
      : {
          href: router.buildLocation({ to: "/", search: { screens: [preview.screenId] } }).href,
          label: "Screen preview",
          ariaLabel: "Open screen preview",
          content: <ScreenPreview key={preview.screenId} screenId={preview.screenId} />,
        };
  const link = (
    <a
      href={target.href}
      target="_blank"
      rel="noreferrer"
      aria-label={target.ariaLabel}
      onClick={(event) => {
        if (preview.kind !== "screen") return;
        event.preventDefault();
        surface.reveal(createScreenPane(preview.screenId));
        onOpen?.();
      }}
      className={
        variant === "inline"
          ? "font-medium text-foreground underline underline-offset-2"
          : variant === "row"
            ? cn(
                buttonVariants({ variant: "outline", size: "sm" }),
                "flex w-full min-w-0 justify-start font-normal",
              )
            : outputPillClassName
      }
    >
      {variant !== "inline" && <MonitorPlay className="size-3.5 shrink-0" />}
      {variant === "inline" ? target.label : "Preview"}
      {variant === "row" && (
        <>
          <span className="min-w-0 flex-1 truncate text-left text-muted-foreground">
            {target.label}
          </span>
          <ExternalLink />
        </>
      )}
    </a>
  );
  if (variant === "inline") return link;
  return (
    <PreviewCard>
      <PreviewCardTrigger delay={400} render={link} />
      {!isMobile && (
        <PreviewCardContent side="top" align="end" sideOffset={8} className="p-2">
          {target.content}
          <p className="mt-2 truncate text-xs text-muted-foreground" title={target.label}>
            {target.label}
          </p>
        </PreviewCardContent>
      )}
    </PreviewCard>
  );
}
