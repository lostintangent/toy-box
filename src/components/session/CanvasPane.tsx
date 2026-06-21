import { ArrowLeft } from "lucide-react";
import type { SessionGridPane } from "@/hooks/session/sessionPanes";
import { usePreferredColorScheme } from "@/hooks/browser/usePreferredColorScheme";
import { Button } from "@/components/ui/button";

type CanvasGridPane = Extract<SessionGridPane, { kind: "canvas" }>;

export function CanvasPane({ pane, onBack }: { pane: CanvasGridPane; onBack?: () => void }) {
  const { canvas } = pane;
  const title = canvas.title || canvas.canvasId;
  const src = resolveCanvasUrl(canvas.url);
  const canRender = isRenderableCanvasUrl(src);
  const colorScheme = usePreferredColorScheme();

  return (
    <div className="flex h-full flex-col bg-background" style={{ colorScheme }}>
      <div className="flex min-h-11 items-center gap-2 border-b px-3 py-2 pr-24">
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack} className="shrink-0">
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          {canvas.status && (
            <div className="truncate text-xs text-muted-foreground">{canvas.status}</div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {canRender ? (
          <iframe
            src={src}
            title={title}
            className="h-full w-full border-0"
            referrerPolicy="no-referrer"
            style={{ colorScheme }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Canvas URL is unavailable.
          </div>
        )}
      </div>
    </div>
  );
}

export function resolveCanvasUrl(url: string, currentHostname = readCurrentHostname()): string {
  if (!currentHostname) return url;

  try {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1") {
      const canvasPort = parsed.port;
      parsed.hostname = currentHostname;
      parsed.port = canvasPort;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

function readCurrentHostname(): string | undefined {
  return typeof window === "undefined" ? undefined : window.location.hostname;
}

function isRenderableCanvasUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
