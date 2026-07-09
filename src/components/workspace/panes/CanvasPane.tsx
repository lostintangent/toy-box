import type { SessionCanvas } from "@/types";
import { usePreferredColorScheme } from "@/hooks/browser/usePreferredColorScheme";

export function CanvasPane({ canvas }: { canvas: SessionCanvas }) {
  const title = canvas.title || canvas.canvasId;
  const src = resolveCanvasUrl(canvas.url);
  const colorScheme = usePreferredColorScheme();

  return (
    <div className="flex h-full flex-col bg-background" style={{ colorScheme }}>
      <div className="flex min-h-11 items-center gap-2 border-b px-3 py-2 pr-24">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{title}</div>
          {canvas.status && (
            <div className="truncate text-xs text-muted-foreground">{canvas.status}</div>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {src ? (
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

export function resolveCanvasUrl(
  url: string,
  currentHostname = typeof window === "undefined" ? undefined : window.location.hostname,
): string | undefined {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    if (currentHostname && parsed.hostname === "127.0.0.1") {
      parsed.hostname = currentHostname;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}
