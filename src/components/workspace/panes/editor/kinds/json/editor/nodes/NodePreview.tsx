import {
  childCount,
  isIdentityKey,
  scalarTypeOf,
  type JsonNode,
  type JsonScalar,
} from "../../document";
import { useJsonTheme } from "../../theme";
import { ContainerSummary } from "./ContainerSummary";
import { valueText } from "./values";

// A read-only, non-interactive rendering of one node's subtree — the body of the
// reference hovercard. It borrows the tree's visual language (identity chips, typed
// value colors, container summaries) but none of its editing machinery, and stops at
// PREVIEW_MAX_DEPTH so even a deep target stays a glanceable card.

const PREVIEW_MAX_DEPTH = 3;
const INDENT_STEP = 12;

export function NodePreview({ node }: { node: JsonNode }) {
  return (
    <div className="max-h-72 overflow-auto font-mono text-[13px] leading-6">
      <PreviewRow node={node} depth={0} />
    </div>
  );
}

function PreviewRow({
  node,
  keyLabel,
  depth,
}: {
  node: JsonNode;
  keyLabel?: string;
  depth: number;
}) {
  const theme = useJsonTheme();
  const expanded = node.kind !== "scalar" && depth < PREVIEW_MAX_DEPTH && childCount(node) > 0;

  return (
    <div>
      <div
        className="flex items-center gap-1 whitespace-nowrap"
        style={{ paddingLeft: depth * INDENT_STEP }}
      >
        {keyLabel !== undefined && (
          <span className="shrink-0 text-foreground">
            {isIdentityKey(keyLabel) ? (
              <span
                className="rounded px-1 font-medium"
                style={{
                  color: theme.accent,
                  backgroundColor: `color-mix(in srgb, ${theme.accent} 14%, transparent)`,
                }}
              >
                {keyLabel}
              </span>
            ) : (
              keyLabel
            )}
            <span className="text-muted-foreground">: </span>
          </span>
        )}
        {node.kind === "scalar" ? (
          <ScalarValue value={node.value} />
        ) : (
          <ContainerSummary node={node} collapsed={!expanded} />
        )}
      </div>

      {expanded && (
        <div>
          {node.kind === "object"
            ? node.members.map((member) => (
                <PreviewRow
                  key={member.node.id}
                  node={member.node}
                  keyLabel={member.key}
                  depth={depth + 1}
                />
              ))
            : node.kind === "array"
              ? node.items.map((item) => <PreviewRow key={item.id} node={item} depth={depth + 1} />)
              : null}
        </div>
      )}
    </div>
  );
}

function ScalarValue({ value }: { value: JsonScalar }) {
  const theme = useJsonTheme();
  if (typeof value === "string") {
    return (
      <span className="truncate" style={{ color: theme.values.string }}>
        <span className="text-muted-foreground">"</span>
        {value}
        <span className="text-muted-foreground">"</span>
      </span>
    );
  }
  return (
    <span className="truncate" style={{ color: theme.values[scalarTypeOf(value)] }}>
      {valueText(value)}
    </span>
  );
}
