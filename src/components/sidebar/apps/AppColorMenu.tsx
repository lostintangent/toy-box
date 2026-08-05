import { Palette } from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
import { isHexColor, type HexColor } from "@/lib/utils";

const PRESET_COLORS: Array<{ name: string; value: HexColor }> = [
  { name: "Gray", value: "#71717a" },
  { name: "Red", value: "#ef4444" },
  { name: "Orange", value: "#f97316" },
  { name: "Amber", value: "#f59e0b" },
  { name: "Green", value: "#22c55e" },
  { name: "Blue", value: "#3b82f6" },
  { name: "Violet", value: "#8b5cf6" },
  { name: "Pink", value: "#ec4899" },
];

export function AppColorMenu({
  color,
  disabled,
  onColorChange,
}: {
  color: HexColor;
  disabled: boolean;
  onColorChange: (color: HexColor) => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger disabled={disabled}>
        <Palette />
        Change color
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={PRESET_COLORS.some(({ value }) => value === color) ? color : ""}
          onValueChange={(value) => {
            if (isHexColor(value)) onColorChange(value);
          }}
        >
          {PRESET_COLORS.map(({ name, value }) => (
            <DropdownMenuRadioItem key={value} value={value} className="gap-2">
              <ColorSwatch color={value} />
              {name}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
          <label>
            <ColorSwatch color={color} />
            Custom…
            <input
              type="color"
              value={color}
              disabled={disabled}
              aria-label="Custom app color"
              className="absolute inset-0 size-full cursor-pointer opacity-0"
              onChange={(event) => {
                const value = event.currentTarget.value;
                if (isHexColor(value)) onColorChange(value);
              }}
            />
          </label>
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ColorSwatch({ color }: { color: HexColor }) {
  return (
    <span
      aria-hidden="true"
      className="size-3.5 shrink-0 rounded-full border border-black/10"
      style={{ backgroundColor: color }}
    />
  );
}
