// A JSON Pointer (RFC 6901) names a location in the document independent of node
// identity, so it survives the re-parse that node ids do not. It is the shared
// coordinate every agent feature speaks in: what the diff marks, what a spawned
// worker targets, and what a presence indicator lights up.

export type JsonPointer = string;

/** The document root, addressed by the empty pointer. */
export const ROOT_POINTER: JsonPointer = "";

/** Extend a pointer by one step — an object key or an array index. */
export function childPointer(parent: JsonPointer, step: string | number): JsonPointer {
  return `${parent}/${escapeToken(String(step))}`;
}

function escapeToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}
