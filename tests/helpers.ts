import type { SdkSessionEvent } from "@/functions/sdk/extractors";

/** Load a committed session fixture (raw SDK events, one JSON object per line). */
export async function loadSessionFixture(name: string): Promise<SdkSessionEvent[]> {
  const url = new URL(`./fixtures/${name}.jsonl`, import.meta.url);
  const text = await Bun.file(url.pathname).text();
  return text
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
}
