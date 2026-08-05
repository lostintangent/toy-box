import type { ComponentProps } from "react";
import { useSelector } from "@tanstack/react-store";
import { Circle, Loader2, PanelTop, Sparkles } from "lucide-react";
import { ModelConfigurationPicker } from "@/components/composer/ModelPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AppSession } from "@/lib/apps/sdk";
import type { ModelConfiguration } from "@/types";
import { cn } from "@/lib/utils";
import { useAppHost } from "../../host/context";

export { FilePicker as AppFilePicker } from "@/components/workspace/fs/FilePicker";
export { SessionLocationPicker as AppLocationPicker } from "@/components/workspace/panes/session/location/SessionLocationPicker";

export function AppShell({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="app-shell"
      className={cn(
        "@container h-full min-h-0 overflow-auto bg-background text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function AppHeader({ className, ...props }: ComponentProps<"header">) {
  return (
    <header
      data-slot="app-header"
      className={cn(
        "flex shrink-0 items-center gap-3 border-b bg-background/95 py-3 pl-4 pr-[calc(1rem+var(--toybox-pane-actions-inset,0px))] backdrop-blur @md:pl-6 @md:pr-[calc(1.5rem+var(--toybox-pane-actions-inset,0px))]",
        className,
      )}
      {...props}
    />
  );
}

export function AppEmptyState({
  title,
  description,
  children,
  className,
  ...props
}: ComponentProps<"div"> & {
  title: string;
  description?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-52 flex-col items-center justify-center gap-2 rounded-xl border border-dashed bg-muted/25 p-8 text-center",
        className,
      )}
      {...props}
    >
      <h2 className="font-medium">{title}</h2>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {children}
    </div>
  );
}

export function AppAlert({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      {...props}
      role="alert"
      data-slot="app-alert"
      className={cn(
        "rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive",
        className,
      )}
    />
  );
}

export const AppButton = Button;
export const AppInput = Input;
export const AppTextarea = Textarea;
export const AppBadge = Badge;

export function AppSessionStatus({
  status,
  className,
  ...props
}: Omit<ComponentProps<"span">, "children"> & { status: AppSession["status"] }) {
  const running = status === "running";
  const finished = status === "unread";
  return (
    <Badge
      {...props}
      variant="outline"
      className={cn(
        "gap-1.5",
        running
          ? "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300"
          : finished
            ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
            : "text-muted-foreground",
        className,
      )}
    >
      {running ? (
        <Loader2 aria-hidden="true" className="size-3 animate-spin" />
      ) : finished ? (
        <Sparkles aria-hidden="true" className="size-3" />
      ) : (
        <Circle aria-hidden="true" className="size-2.5" />
      )}
      {running ? "Running" : finished ? "Finished" : status === "draft" ? "Draft" : "Idle"}
    </Badge>
  );
}

export function AppSessionToggle({
  sessionId,
  children,
  className,
  variant,
  size = "sm",
  ...props
}: Omit<ComponentProps<typeof Button>, "asChild" | "aria-pressed" | "onClick" | "type"> & {
  sessionId: string;
}) {
  const { workspace, actions } = useAppHost();
  const isOpen = useSelector(workspace, ({ openSessionIds }) => openSessionIds.includes(sessionId));
  const usesDefaultContent = children == null;

  return (
    <Button
      {...props}
      type="button"
      variant={variant ?? (isOpen ? "secondary" : "outline")}
      size={size}
      className={cn(usesDefaultContent && "h-7 shrink-0 gap-1.5 px-2.5 text-xs", className)}
      aria-pressed={isOpen}
      onClick={() => actions.toggleSession(sessionId)}
    >
      {children ?? (
        <>
          <PanelTop aria-hidden="true" className="size-3.5" />
          {isOpen ? "Close" : "Open"}
        </>
      )}
    </Button>
  );
}

export function AppModelPicker({
  value,
  onValueChange,
}: {
  value: ModelConfiguration;
  onValueChange: (value: ModelConfiguration) => void;
}) {
  const models = useSelector(useAppHost().workspace, (workspace) => workspace.models);
  if (models.length === 0) {
    return <span className="px-2 text-xs text-muted-foreground">{value.name}</span>;
  }
  return (
    <span className="inline-flex items-center">
      <ModelConfigurationPicker models={models} value={value} onValueChange={onValueChange} />
    </span>
  );
}
