import { CloudPlaceholder, type Ink } from "@/shared/components/ink-cloud/CloudPlaceholder";

/** The user's own ink at rest, rising gently, settled low in its frame near the prompt. */
const INKS: Ink[] = [
  { color: "var(--user-accent)", home: { x: 0, y: 16 }, drift: { x: 0, y: -25 } },
];

/** The draft transcript before its first message. */
export function TranscriptPlaceholder() {
  return (
    <CloudPlaceholder
      className="h-full bg-panel"
      inks={INKS}
      reaction="part"
      title="What would you like to build?"
      description="Ask a question or describe your idea below"
    />
  );
}
