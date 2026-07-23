import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { PANE_OVERLAY_BORDER_CLASS } from "../../../../paneControls";
import { useState, useSyncExternalStore } from "react";
import { useSelector } from "@tanstack/react-store";
import { shallow } from "@tanstack/store";
import { readElementStyle, type SvgDocument } from "../document";
import { resolveActiveTool, styleColor, type EditorStore, type Tool } from "../store";
import {
  ArrowRight,
  ChevronDown,
  Circle,
  Eraser,
  Hand,
  Minus,
  MousePointer2,
  Pen,
  Redo2,
  Square,
  Type,
  Undo2,
} from "lucide-react";
import { FillPicker } from "./FillPicker";

const PRESET_COLORS = [
  "#000000",
  "#ffffff",
  "#ef4444",
  "#22c55e",
  "#3b82f6",
  "#eab308",
  "#a855f7",
  "#06b6d4",
];

const STROKE_WIDTHS = [1, 2, 4, 8, 16];
const FONT_SIZES = [12, 16, 20, 24, 32, 48];

const SHAPE_OPTIONS: Array<{
  type: "rectangle" | "ellipse" | "line" | "arrow";
  icon: React.ReactNode;
  label: string;
}> = [
  { type: "rectangle", icon: <Square size={14} />, label: "Rectangle" },
  { type: "ellipse", icon: <Circle size={14} />, label: "Ellipse" },
  { type: "line", icon: <Minus size={14} />, label: "Line" },
  { type: "arrow", icon: <ArrowRight size={14} />, label: "Arrow" },
];

/** Presents the toolbar projection of editor state and invokes semantic editor actions. */
export function SvgToolbar({
  document,
  store,
  themeForegroundColor,
  activeTool,
}: {
  document: SvgDocument;
  store: EditorStore;
  themeForegroundColor: string;
  activeTool: Tool;
}) {
  const { readOnly, selectedTool, styleDefaults, selection, canUndo, canRedo } = useSelector(
    store,
    (state) => ({
      readOnly: state.readOnly,
      selectedTool: resolveActiveTool(state),
      styleDefaults: state.styleDefaults,
      selection: state.selection,
      canUndo: state.history.undoStack.length > 0,
      canRedo: state.history.redoStack.length > 0,
    }),
    { compare: shallow },
  );
  const documentSnapshot = useSyncExternalStore(
    document.subscribe,
    document.getSnapshot,
    document.getSnapshot,
  );
  const selectedStyle = readElementStyle(selection, documentSnapshot);
  const defaultColor = styleColor({ styleDefaults }, themeForegroundColor);
  const isEditingSelection = selectedTool === "select" && selectedStyle.colorElements.length > 0;
  const displayColor =
    isEditingSelection && selectedStyle.color ? selectedStyle.color : defaultColor;
  const displayWidth =
    isEditingSelection && selectedStyle.strokeWidth
      ? selectedStyle.strokeWidth
      : styleDefaults.strokeWidth;

  const [lastShape, setLastShape] = useState<"rectangle" | "ellipse" | "line" | "arrow">(
    "rectangle",
  );
  const shape = isShapeTool(selectedTool) ? selectedTool : lastShape;
  const isFillableShape = shape === "rectangle" || shape === "ellipse";
  const showFillPicker =
    (isShapeTool(selectedTool) && isFillableShape) ||
    (selectedTool === "select" && selectedStyle.fillElements.length > 0);
  const displayFill =
    selectedTool === "select" && selectedStyle.fillElements.length > 0
      ? (selectedStyle.fill ?? null)
      : styleDefaults.fill;

  function activateShape(nextShape: "rectangle" | "ellipse" | "line" | "arrow") {
    setLastShape(nextShape);
    store.actions.activateTool(nextShape);
  }

  return (
    <div
      style={{ maxWidth: "calc(100% - 1.5rem)" }}
      className={cn(
        "absolute top-3 left-3 z-10 flex w-max items-center gap-1 overflow-x-auto rounded-md border bg-background p-1.5 text-foreground shadow-sm",
        PANE_OVERLAY_BORDER_CLASS,
      )}
    >
      <div className="flex items-center gap-0.5">
        <ToolButton
          active={activeTool === "hand"}
          muted={selectedTool === "hand" && activeTool !== "hand"}
          onClick={() => store.actions.activateTool("hand")}
          icon={<Hand size={14} />}
          tooltip="Hand tool (pan)"
        />
        <ToolButton
          active={activeTool === "select"}
          muted={selectedTool === "select" && activeTool !== "select"}
          onClick={() => store.actions.activateTool("select")}
          icon={<MousePointer2 size={14} />}
          tooltip="Select tool (click selected text to edit)"
          disabled={readOnly}
        />
      </div>

      <ToolbarDivider />

      <div className="flex items-center gap-0.5">
        <ToolButton
          active={activeTool === "pen"}
          muted={selectedTool === "pen" && activeTool !== "pen"}
          onClick={() => store.actions.activateTool("pen")}
          icon={<Pen size={14} />}
          tooltip="Pen tool"
          disabled={readOnly}
        />
        <ToolButton
          active={activeTool === "eraser"}
          muted={selectedTool === "eraser" && activeTool !== "eraser"}
          onClick={() => store.actions.activateTool("eraser")}
          icon={<Eraser size={14} />}
          tooltip="Eraser tool"
          disabled={readOnly}
        />
        <ToolButton
          active={activeTool === "text"}
          muted={selectedTool === "text" && activeTool !== "text"}
          onClick={() => store.actions.activateTool("text")}
          icon={<Type size={14} />}
          tooltip="Text tool"
          disabled={readOnly}
        />
        <ShapePicker
          active={isShapeTool(activeTool)}
          muted={isShapeTool(selectedTool) && !isShapeTool(activeTool)}
          shape={shape}
          onActivate={activateShape}
          disabled={readOnly}
        />
      </div>

      <ToolbarDivider />

      <div className="flex items-center gap-0.5">
        <ColorPicker
          color={displayColor}
          onColorChange={(color) => store.actions.changeStyle({ property: "color", value: color })}
          disabled={
            readOnly ||
            selectedTool === "eraser" ||
            selectedTool === "hand" ||
            (selectedTool === "select" && selectedStyle.colorElements.length === 0)
          }
        />
        {showFillPicker && (
          <FillPicker
            fill={displayFill}
            defaultColor={displayColor}
            onFillChange={(fill) => store.actions.changeStyle({ property: "fill", value: fill })}
            colors={PRESET_COLORS}
            disabled={readOnly}
          />
        )}
        <SizeSelector
          key={selectedTool === "text" ? "text-size" : "stroke-size"}
          size={selectedTool === "text" ? styleDefaults.fontSize : displayWidth}
          sizes={selectedTool === "text" ? FONT_SIZES : STROKE_WIDTHS}
          onSizeChange={(value) =>
            store.actions.changeStyle({
              property: selectedTool === "text" ? "fontSize" : "strokeWidth",
              value,
            })
          }
          label={selectedTool === "text" ? "Font" : "Size"}
          disabled={
            readOnly ||
            selectedTool === "hand" ||
            (selectedTool === "select" && selectedStyle.widthElements.length === 0)
          }
        />
      </div>

      <ToolbarDivider />

      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={store.actions.undo}
              disabled={readOnly || !canUndo}
              aria-label="Undo"
              className={cn(
                "p-1 rounded transition-colors shrink-0",
                !readOnly && canUndo ? "hover:bg-foreground/10" : "opacity-40 cursor-not-allowed",
              )}
            >
              <Undo2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Undo (Ctrl+Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={store.actions.redo}
              disabled={readOnly || !canRedo}
              aria-label="Redo"
              className={cn(
                "p-1 rounded transition-colors shrink-0",
                !readOnly && canRedo ? "hover:bg-foreground/10" : "opacity-40 cursor-not-allowed",
              )}
            >
              <Redo2 size={14} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Redo (Ctrl+Shift+Z)</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

type ToolButtonProps = {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  tooltip: string;
  muted?: boolean;
  disabled?: boolean;
};

function ToolButton({ active, onClick, icon, tooltip, muted, disabled }: ToolButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          disabled={disabled}
          aria-label={tooltip}
          className={cn(
            "shrink-0 rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            disabled
              ? undefined
              : active
                ? "bg-accent text-accent-foreground"
                : muted
                  ? "bg-foreground/10 text-muted-foreground"
                  : "hover:bg-foreground/10",
          )}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

function ToolbarDivider() {
  return <Separator orientation="vertical" className="mx-1 h-4! w-px! bg-muted-foreground/50!" />;
}

type ColorPickerProps = {
  color: string;
  onColorChange: (color: string) => void;
  disabled?: boolean;
};

function ColorPicker({ color, onColorChange, disabled }: ColorPickerProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Stroke color ${color}`}
          className={cn(
            "flex items-center gap-1 p-1 rounded transition-colors",
            disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-foreground/10",
          )}
        >
          <div
            className="w-4 h-4 rounded border border-foreground/20"
            style={{ backgroundColor: color }}
          />
          <ChevronDown size={12} className="opacity-50" />
        </button>
      </DropdownMenuTrigger>
      {!disabled && (
        <DropdownMenuContent align="start" className="p-2">
          <div className="grid grid-cols-4 gap-1">
            {PRESET_COLORS.map((presetColor) => (
              <button
                key={presetColor}
                type="button"
                aria-label={`Use ${presetColor}`}
                aria-pressed={color === presetColor}
                onClick={() => onColorChange(presetColor)}
                className={cn(
                  "w-6 h-6 rounded border transition-all",
                  color === presetColor
                    ? "border-user-accent ring-1 ring-user-accent ring-offset-1 ring-offset-background"
                    : "border-foreground/20 hover:border-foreground/40",
                )}
                style={{ backgroundColor: presetColor }}
              />
            ))}
          </div>
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

type SizeSelectorProps = {
  size: number;
  sizes: number[];
  onSizeChange: (size: number) => void;
  label: string;
  disabled?: boolean;
};

function SizeSelector({ size, sizes, onSizeChange, label, disabled }: SizeSelectorProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`${label} ${size}px`}
          className={cn(
            "flex items-center gap-1 px-1.5 py-1 rounded transition-colors text-xs min-w-[40px] justify-between",
            disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-foreground/10",
          )}
        >
          <span>{size}</span>
          <ChevronDown size={12} className="opacity-50" />
        </button>
      </DropdownMenuTrigger>
      {!disabled && (
        <DropdownMenuContent align="start">
          {sizes.map((option) => (
            <DropdownMenuItem
              key={option}
              onClick={() => onSizeChange(option)}
              className={cn(size === option && "bg-accent")}
            >
              {label} {option}px
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

type ShapePickerProps = {
  active: boolean;
  shape: "rectangle" | "ellipse" | "line" | "arrow";
  onActivate: (shape: "rectangle" | "ellipse" | "line" | "arrow") => void;
  muted?: boolean;
  disabled?: boolean;
};

function ShapePicker({ active, shape, onActivate, muted, disabled }: ShapePickerProps) {
  const currentShape = SHAPE_OPTIONS.find((option) => option.type === shape) ?? SHAPE_OPTIONS[0];

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Shape tool: ${currentShape.label}`}
              onClick={() => onActivate(shape)}
              className={cn(
                "flex shrink-0 items-center gap-0.5 rounded p-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                disabled
                  ? undefined
                  : active
                    ? "bg-accent text-accent-foreground"
                    : muted
                      ? "bg-foreground/10 text-muted-foreground"
                      : "hover:bg-foreground/10",
              )}
            >
              {currentShape.icon}
              <ChevronDown size={10} className="opacity-50" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>Shape tool ({currentShape.label})</TooltipContent>
      </Tooltip>
      {!disabled && (
        <DropdownMenuContent align="start">
          {SHAPE_OPTIONS.map((shape) => (
            <DropdownMenuItem
              key={shape.type}
              onClick={() => onActivate(shape.type)}
              className={cn(
                "flex items-center gap-2",
                currentShape.type === shape.type && "bg-accent",
              )}
            >
              {shape.icon}
              {shape.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      )}
    </DropdownMenu>
  );
}

function isShapeTool(tool: Tool): tool is "rectangle" | "ellipse" | "line" | "arrow" {
  return tool === "rectangle" || tool === "ellipse" || tool === "line" || tool === "arrow";
}
