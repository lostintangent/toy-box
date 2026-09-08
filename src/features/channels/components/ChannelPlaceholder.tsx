import { CloudPlaceholder, type Ink } from "@/shared/components/cloud-placeholder/CloudPlaceholder";

/** cyan-500: the agents' color throughout the app. */
const AGENT_COLOR = "oklch(71.5% 0.143 215.221)";

/** Two inks converging: the user's rising from below, the agents' descending from above. */
const INKS: Ink[] = [
  { color: "var(--user-accent)", home: { x: 0, y: 26 }, drift: { x: 0, y: -44 } },
  { color: AGENT_COLOR, home: { x: 0, y: -26 }, drift: { x: 0, y: 44 } },
];

/** The channel before its first message: the inks meet in the middle, and the pointer stirs them. */
export function ChannelPlaceholder() {
  return (
    <CloudPlaceholder
      className="absolute inset-0"
      inks={INKS}
      reaction="stir"
      title="Start a group conversation"
      description="Describe the focus of this channel, and then when ready, type @ to invite and create agents"
    />
  );
}
