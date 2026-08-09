import type { JSONType } from "zod";
import type { Worker } from "@workers/model";

type AgentPromptInput = {
  readonly pointer: string;
  readonly value: string;
  readonly instruction: string;
};

/** The metadata a spawned worker carries so its target location can be recovered. */
export function targetMetadata(pointer: string): JSONType {
  return { pointer };
}

/** The locations of every pending worker, so Leafnode can show their in-progress nodes. */
export function activePointersOf(workers: Worker[]): ReadonlySet<string> {
  return new Set(
    workers.flatMap((worker) => {
      const pointer = readPointer(worker.metadata);
      return pointer === null ? [] : [pointer];
    }),
  );
}

function readPointer(metadata: JSONType | undefined): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return typeof metadata.pointer === "string" ? metadata.pointer : null;
}

const VALUE_PREVIEW_LIMIT = 4_000;

/** The complete instruction a worker receives to change one location and nothing else. */
export function buildAgentPrompt({ pointer, value, instruction }: AgentPromptInput): string {
  const location =
    pointer === "" ? "the root of this JSON document" : `the value at JSON Pointer \`${pointer}\``;
  const preview =
    value.length > VALUE_PREVIEW_LIMIT
      ? `${value.slice(0, VALUE_PREVIEW_LIMIT)}\n… (truncated — read the file for the full value)`
      : value;
  return [
    `You are editing a JSON artifact. Focus on ${location}.`,
    `Its current value is:\n${preview}`,
    `Requested change: ${instruction}`,
    "Apply the requested change to this location or its contents, including adding, replacing, or removing values as requested. Edit the artifact file, keep it valid JSON, and do not change unrelated locations.",
  ].join("\n\n");
}
