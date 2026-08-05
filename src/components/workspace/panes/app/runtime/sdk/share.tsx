import { useState } from "react";
import { ChevronDown, Loader2, Share2 } from "lucide-react";
import { useSelector } from "@tanstack/react-store";
import { Button } from "@/components/ui/button";
import { shareWithApp } from "@/functions/apps";
import { useWorkspaceSurface } from "@/hooks/workspace/layout/surface";
import { smallJsonSchema } from "@/lib/smallJson";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useAppHost } from "../../host/context";

/** Shares MIME-typed content with a compatible saved app. */
export function AppSharePicker({
  mimeType,
  content,
  label = "Share",
  className,
  disabled,
}: {
  mimeType: string;
  content: unknown;
  label?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { appState, workspace } = useAppHost();
  const surface = useWorkspaceSurface();
  const appId = useSelector(appState.store, (app) => app.id);
  const apps = useSelector(workspace, (state) => state.apps);
  const targets = apps.filter((app) => app.id !== appId && app.accepts.includes(mimeType));
  const [open, setOpen] = useState(false);
  const [sharingWith, setSharingWith] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function share(targetAppId: string) {
    setSharingWith(targetAppId);
    setError(null);
    try {
      await shareWithApp({
        data: {
          appId,
          targetAppId,
          mimeType,
          content: smallJsonSchema.parse(content),
        },
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to share content.");
      setSharingWith(null);
      return;
    }
    setSharingWith(null);
    setOpen(false);
    surface.openApp(targetAppId);
  }

  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setError(null);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn("h-7 gap-1 px-2 text-xs", className)}
          disabled={disabled || sharingWith !== null}
        >
          {sharingWith ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <Share2 aria-hidden="true" className="size-3.5" />
          )}
          {label}
          <ChevronDown aria-hidden="true" className="size-3 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {targets.length === 0 ? (
          <DropdownMenuItem disabled>No supporting apps</DropdownMenuItem>
        ) : (
          targets.map((target) => (
            <DropdownMenuItem
              key={target.id}
              disabled={sharingWith !== null}
              onSelect={(event) => {
                event.preventDefault();
                void share(target.id);
              }}
            >
              {target.title}
              {sharingWith === target.id ? (
                <Loader2 aria-hidden="true" className="ml-auto size-3.5 animate-spin" />
              ) : null}
            </DropdownMenuItem>
          ))
        )}
        {error ? (
          <DropdownMenuItem
            disabled
            className="max-w-72 whitespace-normal text-destructive data-[disabled]:opacity-100"
          >
            {error}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
