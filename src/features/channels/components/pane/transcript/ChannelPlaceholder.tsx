import { CloudPlaceholder, type Ink } from "@/shared/components/ink-cloud/CloudPlaceholder";

/** Two inks converging: the user's rising from below, the agents' descending from above. */
const INKS: Ink[] = [
  { color: "var(--accent)", home: { x: 0, y: 26 }, drift: { x: 0, y: -44 } },
  { color: "var(--agent-accent)", home: { x: 0, y: -26 }, drift: { x: 0, y: 44 } },
];

/** The channel before its first message: the inks meet in the middle, and the pointer stirs them. */
export function ChannelPlaceholder() {
  return (
    <CloudPlaceholder
      className="absolute inset-0"
      inks={INKS}
      reaction="stir"
      title="Your lead is getting started"
      description="Send a message or type @ to add a member"
    />
  );
}
