import { ArrowRight } from "lucide-react";
import { cn } from "@/shared/utils";
import {
  intentMapGraph,
  type IntentDefinition,
  type IntentEntity,
  type IntentEntityId,
  type IntentMapGraph,
  type IntentMapGraphNode,
  type MapSection,
} from "../model/index";
import { ChangeTag, decisionStatusLabel, intentRelationLabel, SectionEmptyState } from "./shared";

export function IntentMapSection({
  definition,
  section,
  focusedEntityId,
  onInspect,
}: {
  definition: IntentDefinition;
  section: MapSection;
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
}) {
  const graph = intentMapGraph(definition, section);
  if (graph.relations.length === 0) {
    return (
      <SectionEmptyState
        title="Nothing in this map is connected yet"
        detail="A choice may need to be explored, or the relationships this map follows may no longer apply."
      />
    );
  }

  const nodes = graph.stages.flat();
  const entities = new Map(nodes.map(({ entity }) => [entity.id, entity]));
  return (
    <div className="space-y-3">
      {section.layout === "paths" && <MapPaths graph={graph} onInspect={onInspect} />}
      {section.layout === "network" ? (
        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
          {nodes.map((node) => (
            <MapNode
              key={node.entity.id}
              node={node}
              entities={entities}
              focusedEntityId={focusedEntityId}
              onInspect={onInspect}
            />
          ))}
        </div>
      ) : (
        <MapStages
          graph={graph}
          entities={entities}
          focusedEntityId={focusedEntityId}
          onInspect={onInspect}
        />
      )}
    </div>
  );
}

function MapPaths({
  graph,
  onInspect,
}: {
  graph: IntentMapGraph;
  onInspect: (entityId: IntentEntityId) => void;
}) {
  return (
    <div className="space-y-2">
      <div aria-label="Routes through this map" className="grid gap-2 lg:grid-cols-2">
        {graph.paths.map((path) => {
          const entities = new Map(path.nodes.map(({ entity }) => [entity.id, entity]));
          const root = entities.get(path.root);
          return (
            <article
              key={path.id}
              data-map-path={path.id}
              className="rounded-lg border border-border p-3"
            >
              <h2 className="text-[11px] font-semibold">{path.title}</h2>
              <p className="mt-1 text-[9.5px] leading-relaxed text-muted-foreground">
                {path.purpose}
              </p>
              {root && (
                <p className="mt-2 text-[8.5px] font-medium uppercase tracking-wide text-sky-400">
                  Starts at {root.label}
                </p>
              )}
              <ul className="mt-1.5 space-y-1">
                {path.relations.map((effective) => {
                  const from = entities.get(effective.relation.from);
                  const to = entities.get(effective.relation.to);
                  if (!from || !to) return null;
                  return (
                    <li key={effective.relation.id}>
                      <button
                        type="button"
                        data-path-relation={effective.relation.id}
                        onClick={() => onInspect(to.id)}
                        className="w-full rounded-md bg-muted px-2 py-1.5 text-left text-[9.5px] text-muted-foreground hover:text-foreground"
                      >
                        <span className="font-medium text-foreground">{from.label}</span>{" "}
                        {intentRelationLabel(effective.relation)}{" "}
                        <span className="font-medium text-foreground">{to.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </article>
          );
        })}
      </div>
      {graph.regions.length > 0 && (
        <div
          aria-label="Named places on this map"
          className="flex flex-wrap gap-1.5 px-1 text-[9px] text-muted-foreground"
        >
          {graph.regions.map((region) => (
            <span key={region.id} className="rounded-full border border-border px-2 py-1">
              {region.title} · {region.nodes.length}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function MapStages({
  graph,
  entities,
  focusedEntityId,
  onInspect,
}: {
  graph: IntentMapGraph;
  entities: ReadonlyMap<IntentEntityId, IntentEntity>;
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
}) {
  return (
    <ol className="space-y-3">
      {graph.stages.map((stage, index) => (
        <li
          key={stage.map((node) => node.entity.id).join(":")}
          className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2.5"
        >
          <div className="relative flex justify-center">
            {index < graph.stages.length - 1 && (
              <div className="absolute inset-y-6 w-px bg-border" />
            )}
            <span className="relative inline-flex size-6 items-center justify-center rounded-full border border-border bg-background text-[9.5px] font-medium tabular-nums text-muted-foreground">
              {index + 1}
            </span>
          </div>
          <div className="grid min-w-0 gap-2.5 lg:grid-cols-2">
            {stage.map((node) => (
              <MapNode
                key={node.entity.id}
                node={node}
                entities={entities}
                focusedEntityId={focusedEntityId}
                onInspect={onInspect}
              />
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

function MapNode({
  node,
  entities,
  focusedEntityId,
  onInspect,
}: {
  node: IntentMapGraphNode;
  entities: ReadonlyMap<IntentEntityId, IntentEntity>;
  focusedEntityId?: IntentEntityId;
  onInspect: (entityId: IntentEntityId) => void;
}) {
  const focused = node.entity.id === focusedEntityId;
  const change = "change" in node.entity ? node.entity.change : undefined;
  return (
    <article
      data-entity-node={node.entity.id}
      data-focused={focused || undefined}
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        focused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
      )}
    >
      <button
        type="button"
        onClick={() => onInspect(node.entity.id)}
        aria-current={focused || undefined}
        className="block w-full p-3 text-left hover:bg-muted/30"
      >
        <span className="flex items-start gap-2">
          <span className="min-w-0 flex-1 text-[11.5px] font-semibold">{node.entity.label}</span>
          {change && <ChangeTag change={change} />}
        </span>
        {node.entity.detail && (
          <span className="mt-1.5 block text-[10px] leading-relaxed text-muted-foreground">
            {node.entity.detail}
          </span>
        )}
      </button>
      {node.outgoing.length > 0 && (
        <div className="space-y-1.5 border-t border-border/60 bg-muted/10 p-2.5">
          {node.outgoing.map((effective) => {
            const target = entities.get(effective.relation.to);
            if (!target) return null;
            const targetFocused = target.id === focusedEntityId;
            return (
              <button
                key={effective.relation.id}
                type="button"
                onClick={() => onInspect(target.id)}
                aria-current={targetFocused || undefined}
                className={cn(
                  "block w-full rounded-md border border-border/50 bg-background/70 px-2 py-1.5 text-left hover:border-muted-foreground/50",
                  targetFocused && "border-sky-400/70 bg-sky-500/10 ring-1 ring-sky-400/40",
                )}
              >
                <span className="flex flex-wrap items-center gap-1 text-[9px] font-medium text-sky-400">
                  {intentRelationLabel(effective.relation)}
                  {effective.status && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-0.5 text-[8.5px]",
                        effective.status === "decided"
                          ? "bg-emerald-500/10 text-emerald-400"
                          : "bg-amber-500/10 text-amber-400",
                      )}
                    >
                      {effective.optionLabel
                        ? `${effective.optionLabel} · ${decisionStatusLabel(effective.status)}`
                        : decisionStatusLabel(effective.status)}
                    </span>
                  )}
                </span>
                <span className="mt-1 flex items-center gap-1 text-[10px] font-medium">
                  <ArrowRight aria-hidden className="size-3 shrink-0 text-muted-foreground" />
                  {target.label}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}
