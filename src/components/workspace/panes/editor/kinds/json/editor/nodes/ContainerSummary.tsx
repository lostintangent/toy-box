import { childCount, declaredId, type JsonNode, type JsonScalar } from "../../document";
import { valueText } from "./values";

// A container's one-line summary beside its caret. Expanded, it's a child count —
// `{ 3 }` / `[ 3 ]`. Collapsed, it turns identifying so a folded list stays readable:
// an object shows the id it declares, and an array previews its first couple of values
// (`[ 1, 2, … ]`), falling back to the count only when neither applies.

const PREVIEW_ITEMS = 2;
const MAX_ITEM_CHARS = 16;

export function ContainerSummary({ node, collapsed }: { node: JsonNode; collapsed: boolean }) {
  const [open, close] = node.kind === "array" ? ["[", "]"] : ["{", "}"];
  const inner = collapsed ? collapsedSummary(node) : countLabel(node);
  return (
    <span className="text-muted-foreground">
      {open}
      {inner && ` ${inner} `}
      {close}
    </span>
  );
}

function collapsedSummary(node: JsonNode): string {
  if (node.kind === "object") return declaredId(node) ?? countLabel(node);
  if (node.kind === "array") return arrayPreview(node.items);
  return "";
}

/** The first couple of items as compact tokens, then `+N` for the remainder so the
 *  array's size still reads at a glance rather than a bare `…`. */
function arrayPreview(items: readonly JsonNode[]): string {
  const shown = items.slice(0, PREVIEW_ITEMS).map(itemToken).join(", ");
  const rest = items.length - PREVIEW_ITEMS;
  return rest > 0 ? `${shown}, +${rest}` : shown;
}

/** One item at a glance: a scalar's value, an object's id (or `{…}`), a nested `[…]`
 *  — clipped so no single value can widen the row. */
function itemToken(node: JsonNode): string {
  const text =
    node.kind === "scalar"
      ? scalarToken(node.value)
      : node.kind === "object"
        ? (declaredId(node) ?? "{…}")
        : "[…]";
  return text.length > MAX_ITEM_CHARS ? `${text.slice(0, MAX_ITEM_CHARS)}…` : text;
}

/** Strings keep their quotes so they read as values (and empties stay visible); other
 *  scalars render bare, matching how the tree shows them. */
function scalarToken(value: JsonScalar): string {
  return typeof value === "string" ? `"${value}"` : valueText(value);
}

function countLabel(node: JsonNode): string {
  const count = childCount(node);
  return count > 0 ? String(count) : "";
}
