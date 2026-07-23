import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Fill } from "../store";
import { ChevronDown } from "lucide-react";

type FillPickerProps = {
  fill: Fill | null;
  defaultColor: string;
  onFillChange: (fill: Fill | null) => void;
  disabled: boolean;
  colors: readonly string[];
};

const FILL_STYLES: Array<{
  style: Fill["style"] | "none";
  label: string;
}> = [
  { style: "none", label: "No fill" },
  { style: "solid", label: "Solid" },
  { style: "diagonal", label: "Diagonal" },
  { style: "cross", label: "Crosshatch" },
  { style: "dots", label: "Dots" },
];

export function FillPicker({
  fill,
  defaultColor,
  onFillChange,
  disabled,
  colors,
}: FillPickerProps) {
  const currentStyle = fill?.style ?? "none";
  const currentColor = fill?.color ?? defaultColor;

  function handleStyleSelect(style: Fill["style"] | "none") {
    if (style === "none") {
      onFillChange(null);
    } else {
      onFillChange({ style, color: currentColor });
    }
  }

  function handleColorSelect(color: string) {
    if (currentStyle === "none") {
      onFillChange({ style: "solid", color });
    } else {
      onFillChange({ style: currentStyle, color });
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Fill style ${currentStyle}`}
          className={cn(
            "flex items-center gap-1 p-1 rounded transition-colors",
            disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-foreground/10",
          )}
        >
          <FillIcon fillStyle={currentStyle} color={currentColor} size={16} />
          <ChevronDown size={12} className="opacity-50" />
        </button>
      </DropdownMenuTrigger>
      {!disabled && (
        <DropdownMenuContent align="start" className="p-2 w-[180px]">
          <div className="flex gap-1 mb-2">
            {FILL_STYLES.map(({ style, label }) => (
              <button
                key={style}
                type="button"
                onClick={() => handleStyleSelect(style)}
                title={label}
                aria-label={label}
                className={cn(
                  "p-1 rounded transition-all",
                  currentStyle === style
                    ? "bg-accent ring-1 ring-accent"
                    : "hover:bg-foreground/10",
                )}
              >
                <FillIcon
                  fillStyle={style}
                  color={style === "none" ? undefined : currentColor}
                  size={20}
                />
              </button>
            ))}
          </div>

          <div
            className={cn(
              "grid grid-cols-4 gap-x-1 gap-y-2 pt-2 border-t border-foreground/10 justify-items-center",
              currentStyle === "none" && "opacity-40 pointer-events-none",
            )}
          >
            {colors.map((color) => (
              <button
                key={color}
                type="button"
                onClick={() => handleColorSelect(color)}
                aria-label={`Use fill color ${color}`}
                aria-pressed={fill?.color === color && currentStyle !== "none"}
                className={cn(
                  "w-6 h-6 rounded border transition-all",
                  fill?.color === color && currentStyle !== "none"
                    ? "border-user-accent ring-1 ring-user-accent ring-offset-1 ring-offset-background"
                    : "border-foreground/20 hover:border-foreground/40",
                )}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

function FillIcon({
  fillStyle,
  color,
  size = 16,
  className,
}: {
  fillStyle: Fill["style"] | "none";
  color?: string;
  size?: number;
  className?: string;
}) {
  const strokeColor = color ?? "currentColor";

  if (fillStyle === "none") {
    return (
      <div
        className={cn("rounded border border-dashed border-foreground/40", className)}
        style={{ width: size, height: size }}
      />
    );
  }

  if (fillStyle === "solid") {
    return (
      <div
        className={cn("rounded border border-foreground/20", className)}
        style={{ width: size, height: size, backgroundColor: strokeColor }}
      />
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={cn("rounded border border-foreground/20", className)}
    >
      <rect width="16" height="16" fill="var(--background)" />
      {fillStyle === "diagonal" && (
        <g stroke={strokeColor} strokeWidth="1">
          <line x1="0" y1="6" x2="6" y2="0" />
          <line x1="0" y1="11" x2="11" y2="0" />
          <line x1="0" y1="16" x2="16" y2="0" />
          <line x1="5" y1="16" x2="16" y2="5" />
          <line x1="10" y1="16" x2="16" y2="10" />
        </g>
      )}
      {fillStyle === "cross" && (
        <g stroke={strokeColor} strokeWidth="1">
          <line x1="0" y1="4" x2="16" y2="4" />
          <line x1="0" y1="12" x2="16" y2="12" />
          <line x1="4" y1="0" x2="4" y2="16" />
          <line x1="12" y1="0" x2="12" y2="16" />
        </g>
      )}
      {fillStyle === "dots" && (
        <g fill={strokeColor}>
          <circle cx="5" cy="5" r="1.5" />
          <circle cx="11" cy="5" r="1.5" />
          <circle cx="5" cy="11" r="1.5" />
          <circle cx="11" cy="11" r="1.5" />
        </g>
      )}
    </svg>
  );
}
