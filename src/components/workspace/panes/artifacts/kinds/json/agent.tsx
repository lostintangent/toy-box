import { createContext, useContext, type ReactNode } from "react";
import type { ArtifactWorker, JsonValue } from "@/types";
import type { JsonPointer } from "./document";

// The bridge between the editor and the agent working alongside it. Both halves
// speak in JSON Pointers: a spawned worker records its target location in opaque
// worker metadata, so presence can light the node it is touching and the diff can
// land on the value it changed. Observing that work is store state (see the store's
// `activePointers`); invoking it is this context, since it needs the pane's
// `spawnWorker` capability.

/** Whether an ask changes the addressed value or adds a new child inside it. */
export type AskIntent = "edit" | "add";

export type AskAgentInput = {
  readonly pointer: JsonPointer;
  readonly valueJson: string;
  readonly instruction: string;
  readonly intent?: AskIntent;
};

type AgentBridge = { readonly askAgent: (input: AskAgentInput) => Promise<void> };

const AgentContext = createContext<AgentBridge | null>(null);

export function AgentProvider({
  askAgent,
  children,
}: {
  askAgent: AgentBridge["askAgent"];
  children: ReactNode;
}) {
  return <AgentContext.Provider value={{ askAgent }}>{children}</AgentContext.Provider>;
}

export function useAgent(): AgentBridge {
  const bridge = useContext(AgentContext);
  if (!bridge) throw new Error("useAgent must be used within an AgentProvider");
  return bridge;
}

/** The metadata a spawned worker carries so its target location can be recovered. */
export function targetMetadata(pointer: JsonPointer): JsonValue {
  return { pointer };
}

/** The locations of every pending worker, so their nodes can show as in progress. */
export function activePointersOf(workers: ArtifactWorker[]): ReadonlySet<JsonPointer> {
  return new Set(
    workers.flatMap((worker) => {
      const pointer = readPointer(worker.metadata);
      return pointer === null ? [] : [pointer];
    }),
  );
}

function readPointer(metadata: JsonValue | undefined): JsonPointer | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return typeof metadata.pointer === "string" ? metadata.pointer : null;
}

const VALUE_PREVIEW_LIMIT = 4_000;

/** The complete instruction a worker receives to change one location and nothing else. */
export function buildAgentPrompt({
  pointer,
  valueJson,
  instruction,
  intent = "edit",
}: AskAgentInput): string {
  const location =
    pointer === "" ? "the root of this JSON document" : `the value at JSON Pointer \`${pointer}\``;
  const preview =
    valueJson.length > VALUE_PREVIEW_LIMIT
      ? `${valueJson.slice(0, VALUE_PREVIEW_LIMIT)}\n… (truncated — read the file for the full value)`
      : valueJson;
  const focus = intent === "add" ? `Add a new entry inside ${location}` : `Focus on ${location}`;
  const ask = intent === "add" ? `What to add: ${instruction}` : `Requested change: ${instruction}`;
  return [
    `You are editing a JSON artifact. ${focus}.`,
    `Its current value is:\n${preview}`,
    ask,
    "Apply the change by editing the artifact file. Keep it valid JSON and change nothing else.",
  ].join("\n\n");
}
