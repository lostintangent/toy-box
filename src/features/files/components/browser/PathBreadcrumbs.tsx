import { ChevronRight } from "lucide-react";

/** Clickable filesystem-path breadcrumbs; each segment re-roots the listing at that ancestor. */
export function PathBreadcrumbs({
  path,
  onNavigate,
}: {
  path: string;
  onNavigate: (path: string) => void;
}) {
  const segments = path.split("/").filter(Boolean);

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-0.5 text-xs text-muted-foreground">
      <button
        type="button"
        onClick={() => onNavigate("/")}
        className="shrink-0 rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
      >
        /
      </button>
      {segments.map((segment, index) => {
        const segmentPath = "/" + segments.slice(0, index + 1).join("/");
        const isLast = index === segments.length - 1;

        return (
          <span key={segmentPath} className="flex items-center gap-0.5">
            <ChevronRight className="h-3 w-3 shrink-0 opacity-40" />
            {isLast ? (
              <span className="truncate rounded px-1 py-0.5 font-medium text-foreground">
                {segment}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate(segmentPath)}
                className="truncate rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
              >
                {segment}
              </button>
            )}
          </span>
        );
      })}
    </div>
  );
}
