import type { JsonScalar } from "../document";

// The text <-> scalar bridge for inline editing. A leaf is edited as plain
// text; on commit its JSON type is inferred the way a person reads it — `true`,
// `false`, `null`, and finite numbers become those types, everything else a
// string. This keeps the common case free of type controls; exotic literal
// strings like "true" are the accepted cost of that simplicity.

export function valueText(value: JsonScalar): string {
  return value === null ? "null" : String(value);
}

export function inferScalar(text: string): JsonScalar {
  const trimmed = text.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if (trimmed !== "" && Number.isFinite(Number(trimmed))) return Number(trimmed);
  return text;
}
