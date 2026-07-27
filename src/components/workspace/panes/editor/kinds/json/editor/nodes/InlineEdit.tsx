import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useJsonTheme } from "../../theme";

// One self-focusing inline field for editing a key or a leaf value. Commit is
// where policy lives: `onCommit` returns false to reject (a duplicate key), which
// keeps the field open and marks it invalid; Escape reverts; blur commits, or
// abandons the edit if the commit is rejected so focus is never trapped.

export function InlineEdit({
  initial,
  onCommit,
  onCancel,
  ariaLabel,
  color,
}: {
  initial: string;
  onCommit: (text: string) => boolean;
  onCancel: () => void;
  ariaLabel: string;
  color?: string;
}) {
  const { accent } = useJsonTheme();
  const [text, setText] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const settled = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  function attempt(onReject: () => void): void {
    if (settled.current) return;
    if (onCommit(text)) settled.current = true;
    else onReject();
  }

  return (
    <input
      ref={inputRef}
      value={text}
      aria-label={ariaLabel}
      spellCheck={false}
      autoComplete="off"
      className={cn(
        "min-w-0 rounded-sm bg-background px-1 font-mono text-[13px] leading-6 outline-none",
      )}
      style={{
        color,
        width: `${Math.max(text.length + 1, 2)}ch`,
        boxShadow: `0 0 0 1.5px ${invalid ? "#ef4444" : accent}`,
      }}
      onChange={(event) => {
        setText(event.target.value);
        setInvalid(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          attempt(() => setInvalid(true));
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => attempt(onCancel)}
    />
  );
}
