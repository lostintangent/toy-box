import type { SessionEvent as SdkSessionEvent } from "@github/copilot-sdk";
import { createSdkEventProjector } from "@providers/server/copilot/projector";
import { replaySessionHistory } from "@sessions/model/reducer";

/** Exercise native history projection and the same finalization used by the snapshot loader. */
export async function replayCopilotHistory(sessionId: string, events: SdkSessionEvent[]) {
  return replaySessionHistory(events.flatMap(createSdkEventProjector(sessionId)));
}

/** Load a committed session fixture (raw SDK events, one JSON object per line). */
export async function loadSessionFixture(name: string): Promise<SdkSessionEvent[]> {
  const url = new URL(`./fixtures/${name}.jsonl`, import.meta.url);
  const text = await Bun.file(url.pathname).text();
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
