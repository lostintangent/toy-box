import { wakeDueChannelAgents } from "./index";

/** Claims commit before delivery, so a tick that overlaps another finds nothing to repeat. */
export default function startChannelWakes(): void {
  setInterval(() => void wakeDueChannelAgents(), 30_000).unref?.();
}
