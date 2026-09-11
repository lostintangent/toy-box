import { useId, useState, type CSSProperties } from "react";
import { ArrowRight, Check } from "lucide-react";
import { cn } from "@/shared/utils";
import {
  INTENT_CHANGES,
  flowGraph,
  flowPathSelectionAfterInspection,
  type Change,
  type FlowExhibit,
  type FlowGraph,
  type FlowGraphNode,
  type IntentDocument,
  type IntentEntityId,
} from "../../model/index";
import { ChangeTag, SectionEmptyState } from "../shared";

const NODE_WIDTH = 132;
const NODE_HEIGHT = 152;
const COLUMN_GAP = 20;
const ROW_GAP = 44;
const FLOW_PADDING = 24;

const CHANGE_BORDER_CLASS: Record<Change, string> = {
  existing: "border-zinc-500/30",
  new: "border-emerald-500/40",
  modified: "border-amber-500/40",
  preserved: "border-sky-500/40",
  removed: "border-rose-500/40",
  renamed: "border-violet-500/40",
  split: "border-violet-500/40",
  relocated: "border-violet-500/40",
};

type PositionedFlowNode = {
  node: FlowGraphNode;
  x: number;
  y: number;
};

export function IntentFlowExhibit({
  document,
  exhibit,
  focusedEntityId,
  onInspect,
}: {
  document: IntentDocument;
  exhibit: FlowExhibit;
  focusedEntityId?: IntentEntityId;
  onInspect?: (entityId: IntentEntityId) => void;
}) {
  const graph = flowGraph(document, exhibit);

  if (graph.connections.length === 0) {
    return (
      <SectionEmptyState
        title="Nothing in this flow is connected yet"
        detail="The flow no longer has a complete path through its current nodes."
      />
    );
  }

  const nodes = graph.stages.flat();
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  return (
    <div className="space-y-3">
      <FlowChangeLegend nodes={nodes} />
      <PathFlow
        graph={graph}
        nodesById={nodesById}
        exhibitId={exhibit.id}
        focusedEntityId={focusedEntityId}
        onInspect={onInspect}
      />
    </div>
  );
}

function PathFlow({
  graph,
  nodesById,
  exhibitId,
  focusedEntityId,
  onInspect,
}: {
  graph: FlowGraph;
  nodesById: ReadonlyMap<string, FlowGraphNode>;
  exhibitId: IntentEntityId;
  focusedEntityId?: IntentEntityId;
  onInspect?: (entityId: IntentEntityId) => void;
}) {
  const [selection, setSelection] = useState<string | undefined>(() => graph.paths[0]?.id);
  const selectedPathId =
    selection === undefined || graph.paths.some((path) => path.id === selection)
      ? selection
      : graph.paths[0]?.id;

  function inspectNode(nodeId: string) {
    const nextPathId = flowPathSelectionAfterInspection(graph, selectedPathId, nodeId);
    if (nextPathId !== selectedPathId) setSelection(nextPathId);
    const node = nodesById.get(nodeId);
    onInspect?.(node?.entity?.id ?? exhibitId);
  }

  return (
    <>
      <FlowPaths
        graph={graph}
        nodesById={nodesById}
        selectedPathId={selectedPathId}
        onSelect={setSelection}
      />
      <PathFlowGraph
        graph={graph}
        nodesById={nodesById}
        selectedPathId={selectedPathId}
        focusedEntityId={focusedEntityId}
        onInspect={inspectNode}
      />
    </>
  );
}

function FlowChangeLegend({ nodes }: { nodes: readonly FlowGraphNode[] }) {
  const counts = new Map<Change, number>();
  for (const node of nodes) {
    if (!node.change) continue;
    counts.set(node.change, (counts.get(node.change) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  return (
    <div
      aria-label="Changes in this flow"
      className="flex flex-wrap items-center gap-2 px-1 text-[9px] text-muted-foreground"
    >
      {INTENT_CHANGES.map((change) => {
        const count = counts.get(change);
        if (!count) return null;
        return (
          <span key={change} className="inline-flex items-center gap-1">
            <ChangeTag change={change} />
            <span>× {count}</span>
          </span>
        );
      })}
    </div>
  );
}

function FlowPaths({
  graph,
  nodesById,
  selectedPathId,
  onSelect,
}: {
  graph: FlowGraph;
  nodesById: ReadonlyMap<string, FlowGraphNode>;
  selectedPathId?: string;
  onSelect: (pathId: string | undefined) => void;
}) {
  const pathConnectionIds = new Set(
    graph.paths.flatMap((path) => path.connections.map((connection) => connection.id)),
  );
  const supporting = graph.connections.filter(
    (connection) => !pathConnectionIds.has(connection.id),
  );

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3 px-1">
        <p className="text-[9.5px] text-muted-foreground">
          Pick one route to follow without losing the rest of the flow.
        </p>
        <button
          type="button"
          aria-pressed={selectedPathId === undefined}
          onClick={() => onSelect(undefined)}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-[9px] text-muted-foreground hover:text-foreground",
            selectedPathId === undefined && "border-sky-400/70 bg-sky-500/10 text-sky-500",
          )}
        >
          Whole flow
        </button>
      </div>
      <div
        aria-label="Paths through this flow"
        className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3"
      >
        {graph.paths.map((path) => {
          const selected = path.id === selectedPathId;
          return (
            <button
              key={path.id}
              type="button"
              data-flow-path={path.id}
              aria-pressed={selected}
              onClick={() => onSelect(path.id)}
              className={cn(
                "rounded-lg border border-border p-3 text-left hover:border-muted-foreground/60",
                selected && "border-sky-400 bg-sky-500/10",
              )}
            >
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-[11px] font-semibold">{path.title}</span>
                {selected ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-[8.5px] font-medium text-sky-500">
                    <Check aria-hidden className="size-2.5" />
                    Following
                  </span>
                ) : (
                  <span className="shrink-0 text-[8.5px] tabular-nums text-muted-foreground">
                    {path.nodes.length} parts
                  </span>
                )}
              </span>
              <span className="mt-1 block text-[9.5px] leading-relaxed text-muted-foreground">
                {path.purpose}
              </span>
            </button>
          );
        })}
      </div>
      {graph.regions.length > 0 && (
        <div
          aria-label="Named places in this flow"
          className="flex flex-wrap gap-1.5 px-1 text-[9px] text-muted-foreground"
        >
          {graph.regions.map((region) => (
            <span key={region.id} className="rounded-full border border-border px-2 py-1">
              {region.title} · {region.nodes.length}
            </span>
          ))}
        </div>
      )}
      {supporting.map((connection) => {
        const from = nodesById.get(connection.from);
        const to = nodesById.get(connection.to);
        if (!from || !to) return null;
        return (
          <div
            key={connection.id}
            data-flow-supporting-connection={connection.id}
            className="rounded-lg border border-dashed border-border px-3 py-2 text-[9px] text-muted-foreground"
          >
            <span className="font-medium text-foreground">{from.label}</span> {connection.label}{" "}
            <span className="font-medium text-foreground">{to.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function PathFlowGraph({
  graph,
  nodesById,
  selectedPathId,
  focusedEntityId,
  onInspect,
}: {
  graph: FlowGraph;
  nodesById: ReadonlyMap<string, FlowGraphNode>;
  selectedPathId?: string;
  focusedEntityId?: IntentEntityId;
  onInspect: (nodeId: string) => void;
}) {
  const markerPrefix = useId().replaceAll(":", "");
  const layout = positionFlowNodes(graph);
  const positions = new Map(layout.nodes.map((position) => [position.node.id, position]));
  const selectedPath = graph.paths.find((path) => path.id === selectedPathId);
  const activeNodeIds = selectedPath
    ? new Set(selectedPath.nodes.map((node) => node.id))
    : undefined;
  const activeConnectionIds = selectedPath
    ? new Set(selectedPath.connections.map((connection) => connection.id))
    : undefined;
  const pathConnectionIds = new Set(
    graph.paths.flatMap((path) => path.connections.map((connection) => connection.id)),
  );
  const startIds = new Set(graph.paths.map((path) => path.start));
  const regionByNode = new Map(
    graph.regions.flatMap((region) => region.nodes.map((node) => [node.id, region.title] as const)),
  );
  const style = {
    "--intent-flow-width": `${layout.width}px`,
    "--intent-flow-height": `${layout.height}px`,
  } as CSSProperties;

  return (
    <div
      data-flow-graph
      className="overflow-x-auto rounded-xl border border-border"
      aria-label="Connected intent flow"
    >
      <div
        style={style}
        className="relative grid gap-3 p-3 lg:mx-auto lg:block lg:h-[var(--intent-flow-height)] lg:w-[var(--intent-flow-width)] lg:p-0"
      >
        <svg
          aria-hidden
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          className="absolute inset-0 hidden size-full lg:block"
        >
          <defs>
            <marker
              id={`${markerPrefix}-active-arrow`}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M0 0L7 3.5L0 7Z" fill="#38bdf8" />
            </marker>
            <marker
              id={`${markerPrefix}-muted-arrow`}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <path d="M0 0L7 3.5L0 7Z" fill="#a1a1aa" />
            </marker>
          </defs>
          {graph.connections.map((connection) => {
            const from = positions.get(connection.from);
            const to = positions.get(connection.to);
            if (!from || !to) return null;
            const active = !activeConnectionIds || activeConnectionIds.has(connection.id);
            const pathConnection = pathConnectionIds.has(connection.id);
            return (
              <path
                key={connection.id}
                data-flow-connection={connection.id}
                data-path-connection={pathConnection ? connection.id : undefined}
                d={flowConnectionPath(from, to, connection.id)}
                fill="none"
                stroke={active ? "#38bdf8" : "#a1a1aa"}
                strokeWidth={active ? 1.6 : 1.1}
                strokeDasharray={pathConnection ? undefined : "4 4"}
                opacity={active ? 0.9 : 0.4}
                markerEnd={`url(#${markerPrefix}-${active ? "active" : "muted"}-arrow)`}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </svg>
        {layout.nodes.map((position) => (
          <FlowNodeCard
            key={position.node.id}
            node={position.node}
            position={position}
            nodesById={nodesById}
            start={startIds.has(position.node.id)}
            region={regionByNode.get(position.node.id)}
            muted={activeNodeIds ? !activeNodeIds.has(position.node.id) : false}
            activeConnectionIds={activeConnectionIds}
            focusedEntityId={focusedEntityId}
            onInspect={onInspect}
          />
        ))}
      </div>
    </div>
  );
}

function FlowNodeCard({
  node,
  position,
  nodesById,
  start,
  region,
  muted,
  activeConnectionIds,
  focusedEntityId,
  onInspect,
}: {
  node: FlowGraphNode;
  position?: PositionedFlowNode;
  nodesById: ReadonlyMap<string, FlowGraphNode>;
  start?: boolean;
  region?: string;
  muted?: boolean;
  activeConnectionIds?: ReadonlySet<string>;
  focusedEntityId?: IntentEntityId;
  onInspect: (nodeId: string) => void;
}) {
  const connectionDescriptionId = useId();
  const path = position !== undefined;
  const focused = node.entity?.id === focusedEntityId;
  const primaryConnection = path
    ? (node.outgoing.find((connection) => activeConnectionIds?.has(connection.id)) ??
      node.outgoing[0])
    : undefined;

  return (
    <article
      data-flow-node={node.id}
      data-focused={focused || undefined}
      style={position ? { left: position.x, top: position.y } : undefined}
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        node.change && CHANGE_BORDER_CLASS[node.change],
        path && "z-10 transition-opacity lg:absolute lg:h-[152px] lg:w-[132px]",
        muted && "hidden lg:block lg:opacity-40",
        focused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
      )}
    >
      <button
        type="button"
        onClick={() => onInspect(node.id)}
        aria-current={focused || undefined}
        aria-describedby={node.outgoing.length > 0 ? connectionDescriptionId : undefined}
        className={cn("block w-full p-3 text-left hover:bg-muted/30", path && "lg:h-full")}
      >
        {(start || region) && (
          <span className="mb-1.5 flex min-w-0 flex-col items-start gap-1">
            {start && (
              <span className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide text-sky-500">
                Starts here
              </span>
            )}
            {region && (
              <span className="max-w-full truncate rounded-full bg-muted px-1.5 py-0.5 text-[8px] uppercase tracking-wide text-muted-foreground">
                {region}
              </span>
            )}
          </span>
        )}
        {node.change && <ChangeTag change={node.change} />}
        {path && primaryConnection && (
          <span className="mt-1.5 hidden line-clamp-2 text-[8.5px] leading-snug text-sky-500 lg:block">
            {primaryConnection.label}
          </span>
        )}
        <span className="mt-1.5 block line-clamp-3 text-[11px] font-semibold leading-snug">
          {node.label}
        </span>
        {node.detail && (
          <span
            className={cn(
              "mt-1.5 block text-[10px] leading-relaxed text-muted-foreground",
              path && "lg:hidden",
            )}
          >
            {node.detail}
          </span>
        )}
      </button>
      {node.outgoing.length > 0 && (
        <>
          <span id={connectionDescriptionId} className="sr-only">
            {node.outgoing
              .map((connection) => {
                const target = nodesById.get(connection.to);
                return target ? `${connection.label} ${target.label}` : undefined;
              })
              .filter(Boolean)
              .join(". ")}
          </span>
          <div
            className={cn(
              "space-y-1.5 border-t border-border/60 bg-muted/10 p-2.5",
              path && "lg:hidden",
            )}
          >
            {node.outgoing.map((connection) => {
              const target = nodesById.get(connection.to);
              if (!target) return null;
              const targetFocused = target.entity?.id === focusedEntityId;
              return (
                <button
                  key={connection.id}
                  type="button"
                  data-flow-connection={connection.id}
                  onClick={() => onInspect(target.id)}
                  aria-current={targetFocused || undefined}
                  className={cn(
                    "block w-full rounded-md border border-border/50 bg-background/70 px-2 py-1.5 text-left hover:border-muted-foreground/50",
                    targetFocused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
                  )}
                >
                  <span className="flex flex-wrap items-center gap-1 text-[9px] font-medium text-sky-500">
                    {connection.label}
                  </span>
                  <span className="mt-1 flex items-center gap-1 text-[10px] font-medium">
                    <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                    {target.label}
                  </span>
                </button>
              );
            })}
          </div>
        </>
      )}
    </article>
  );
}

function positionFlowNodes(graph: FlowGraph) {
  const pathMembership = new Map<string, number[]>();
  graph.paths.forEach((path, pathIndex) => {
    path.nodes.forEach((node) => {
      pathMembership.set(node.id, [...(pathMembership.get(node.id) ?? []), pathIndex]);
    });
  });

  const laneByEntity = new Map<string, number>();
  for (let stageIndex = graph.stages.length - 1; stageIndex >= 0; stageIndex -= 1) {
    const stage = graph.stages[stageIndex] ?? [];
    const placed = stage
      .map((node, index) => {
        const memberships = pathMembership.get(node.id);
        const targetLanes = node.outgoing.flatMap((connection) => {
          const lane = laneByEntity.get(connection.to);
          return lane === undefined ? [] : [lane];
        });
        const lanes = memberships?.length ? memberships : targetLanes;
        return {
          node,
          index,
          preferred: lanes.length
            ? lanes.reduce((total, lane) => total + lane, 0) / lanes.length
            : index,
        };
      })
      .sort((left, right) => left.preferred - right.preferred || left.index - right.index);
    const occupied = new Set<number>();
    for (const item of placed) {
      const lane = nearestOpenLane(item.preferred, occupied);
      occupied.add(lane);
      laneByEntity.set(item.node.id, lane);
    }
  }

  const nodes = graph.stages.flatMap((stage, stageIndex) =>
    stage.map((node) => ({
      node,
      x: FLOW_PADDING + stageIndex * (NODE_WIDTH + COLUMN_GAP),
      y: FLOW_PADDING + (laneByEntity.get(node.id) ?? 0) * (NODE_HEIGHT + ROW_GAP),
    })),
  );
  const rows = Math.max(0, ...laneByEntity.values()) + 1;
  const columns = Math.max(graph.stages.length, 1);
  return {
    width: FLOW_PADDING * 2 + columns * NODE_WIDTH + (columns - 1) * COLUMN_GAP,
    height: FLOW_PADDING * 2 + rows * NODE_HEIGHT + (rows - 1) * ROW_GAP,
    nodes,
  };
}

function nearestOpenLane(preferred: number, occupied: ReadonlySet<number>): number {
  const origin = Math.max(0, Math.round(preferred));
  for (let distance = 0; ; distance += 1) {
    const lower = origin - distance;
    if (lower >= 0 && !occupied.has(lower)) return lower;
    const upper = origin + distance;
    if (upper !== lower && !occupied.has(upper)) return upper;
  }
}

function flowConnectionPath(
  from: PositionedFlowNode,
  to: PositionedFlowNode,
  connectionId: string,
): string {
  const outgoingIndex = from.node.outgoing.findIndex(
    (connection) => connection.id === connectionId,
  );
  const incomingIndex = to.node.incoming.findIndex((connection) => connection.id === connectionId);
  const fromY =
    from.y + (NODE_HEIGHT * (outgoingIndex + 1)) / (Math.max(from.node.outgoing.length, 1) + 1);
  const toY =
    to.y + (NODE_HEIGHT * (incomingIndex + 1)) / (Math.max(to.node.incoming.length, 1) + 1);

  if (to.x > from.x) {
    const fromX = from.x + NODE_WIDTH;
    const toX = to.x;
    const middleX = (fromX + toX) / 2;
    return `M ${fromX} ${fromY} C ${middleX} ${fromY}, ${middleX} ${toY}, ${toX} ${toY}`;
  }

  const fromX = from.x + NODE_WIDTH;
  const toX = to.x + NODE_WIDTH;
  const outsideX = Math.max(fromX, toX) + COLUMN_GAP / 2;
  return `M ${fromX} ${fromY} C ${outsideX} ${fromY}, ${outsideX} ${toY}, ${toX} ${toY}`;
}
