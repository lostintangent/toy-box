import { Eye, Pencil, UsersRound, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MetadataBadge } from "@/components/ui/metadata-badge";
import type { ArtifactPaneMode } from "@/hooks/session/sessionPanes";
import { cn } from "@/lib/utils";

type ArtifactModeOption = {
  value: ArtifactPaneMode;
  label: string;
  description: string;
  Icon: LucideIcon;
  badgeClassName: string;
  iconClassName: string;
};

type ArtifactModeMenuProps = {
  mode: ArtifactPaneMode;
  onModeChange: (mode: ArtifactPaneMode) => void;
  className?: string;
  iconClassName?: string;
  showLabel?: boolean;
};

const ARTIFACT_MODE_OPTIONS = [
  {
    value: "read",
    label: "Read",
    description: "Read-only artifact",
    Icon: Eye,
    badgeClassName: "border-primary/40 text-primary",
    iconClassName: "text-primary hover:text-primary",
  },
  {
    value: "edit",
    label: "Edit",
    description: "Edit without notifying the agent",
    Icon: Pencil,
    badgeClassName: "border-amber-500/40 text-amber-600 dark:text-amber-400",
    iconClassName:
      "text-amber-600 hover:text-amber-600 dark:text-amber-400 dark:hover:text-amber-400",
  },
  {
    value: "shared",
    label: "Shared",
    description: "Edit and notify the agent",
    Icon: UsersRound,
    badgeClassName: "border-green-500/40 text-green-600 dark:text-green-400",
    iconClassName:
      "text-green-600 hover:text-green-600 dark:text-green-400 dark:hover:text-green-400",
  },
] satisfies ArtifactModeOption[];

const DEFAULT_OPTION = ARTIFACT_MODE_OPTIONS[2];

export function ArtifactModeMenu({
  mode,
  onModeChange,
  className,
  iconClassName,
  showLabel = true,
}: ArtifactModeMenuProps) {
  const option = ARTIFACT_MODE_OPTIONS.find((entry) => entry.value === mode) ?? DEFAULT_OPTION;
  const { Icon } = option;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {showLabel ? (
          <Button
            type="button"
            variant="ghost"
            aria-label={`Artifact mode: ${option.label}`}
            title={option.description}
            className="h-auto rounded-full p-0 hover:bg-transparent"
          >
            <MetadataBadge
              className={cn(
                "h-6 cursor-pointer select-none rounded-full border bg-transparent px-2 text-xs transition-colors hover:bg-muted",
                option.badgeClassName,
                className,
              )}
            >
              <Icon className={cn("h-3 w-3 shrink-0", option.iconClassName, iconClassName)} />
              <span>{option.label}</span>
            </MetadataBadge>
          </Button>
        ) : (
          <button
            type="button"
            aria-label={`Artifact mode: ${option.label}`}
            title={option.description}
            className={cn(className, option.badgeClassName)}
          >
            <Icon className={cn(iconClassName, option.iconClassName)} />
          </button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-max min-w-max"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {ARTIFACT_MODE_OPTIONS.map(({ value, label, description, Icon: OptionIcon }) => (
          <DropdownMenuItem
            key={value}
            className={cn("gap-2 text-xs", mode === value && "bg-accent text-accent-foreground")}
            onSelect={() => onModeChange(value)}
          >
            <OptionIcon
              className={cn(
                "h-3.5 w-3.5",
                mode === value ? "text-accent-foreground" : "text-muted-foreground",
              )}
            />
            <span>{label}</span>
            <span className="sr-only">{description}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
