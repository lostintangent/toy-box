import type {
  BriefDocument,
  BriefEntityId,
  Decision,
  DecisionOption,
  FlowConnection,
  FlowExhibit,
  OptionRelationship,
  OptionStatus,
} from "../schema";
import { flowGraph, type FlowGraphNode } from "../spec/flow";
import { briefEntitiesFrom, type BriefEntity } from "./entities";
import { activeOptions, type ActiveOption } from "./options";
import { buildBriefIndex, type BriefIndex } from "./structure";

/**
 * The links a reader can follow from one entity. Each authored reference lives
 * on one side only; links read grounding, impact, implementation, flow
 * connections, and active option relationships from both ends, and a record's
 * origin from the option that adds it.
 */
export type EntityLinks = {
  /** Findings this entity is based on. */
  basedOn: BriefEntity[];
  /** Entities based on this finding. */
  grounds: BriefEntity[];
  /** Entities this question or decision affects. */
  affects: BriefEntity[];
  /** Questions and decisions that affect this entity. */
  affectedBy: BriefEntity[];
  /** Entities this plan step implements. */
  implements: BriefEntity[];
  /** Plan steps that implement this entity. */
  implementedBy: BriefEntity[];
  /** The decision option that adds this record, whether or not it is active. */
  origin?: { decision: Decision; option: DecisionOption; status: OptionStatus };
  /** Connections that reach this entity in section flows. */
  flows: FlowLink[];
  /** Relationships that active decision options draw to or from this entity. */
  activeRelationships: ActiveRelationship[];
};

export type FlowLink = {
  flow: FlowExhibit;
  connection: FlowConnection;
  outgoing: boolean;
  related: FlowGraphNode;
};

export type ActiveRelationship = {
  relationship: OptionRelationship;
  outgoing: boolean;
  related: BriefEntity;
  activeOption: ActiveOption;
};

export function entityLinks(document: BriefDocument, entityId: BriefEntityId): EntityLinks {
  const index = buildBriefIndex(document.sections);
  const entities = briefEntitiesFrom(index);
  const entitiesById = new Map(entities.map((entity) => [entity.id, entity]));
  const resolve = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const entity = entitiesById.get(id);
      return entity ? [entity] : [];
    });
  const entity = entitiesById.get(entityId);
  const origin = recordOrigin(index, entityId);

  return {
    basedOn: resolve(entity ? basedOnFindingIds(entity) : []),
    grounds: entities.filter((candidate) => basedOnFindingIds(candidate).includes(entityId)),
    affects: resolve(entity ? affectedEntityIds(entity) : []),
    affectedBy: entities.filter((candidate) => affectedEntityIds(candidate).includes(entityId)),
    implements: resolve(entity?.type === "plan-step" ? entity.step.implements : []),
    implementedBy: entities.filter(
      (candidate) => candidate.type === "plan-step" && candidate.step.implements.includes(entityId),
    ),
    ...(origin ? { origin } : {}),
    flows: flowLinks(document, index, entityId),
    activeRelationships: activeOptions(index).flatMap((activeOption) =>
      (activeOption.option.relationships ?? []).flatMap((relationship) => {
        const outgoing = relationship.from === entityId;
        if (!outgoing && relationship.to !== entityId) return [];
        const related = entitiesById.get(outgoing ? relationship.to : relationship.from);
        return related ? [{ relationship, outgoing, related, activeOption }] : [];
      }),
    ),
  };
}

function basedOnFindingIds(entity: BriefEntity): readonly string[] {
  if (entity.type === "record") return entity.record.basedOn ?? [];
  if (entity.type === "exhibit") return entity.exhibit.basedOn ?? [];
  if (entity.type === "decision") return entity.decision.basedOn ?? [];
  return [];
}

function affectedEntityIds(entity: BriefEntity): readonly string[] {
  if (entity.type === "question") return entity.question.affects;
  if (entity.type === "decision") return entity.decision.affects;
  return [];
}

function recordOrigin(index: BriefIndex, recordId: string): EntityLinks["origin"] {
  for (const decision of index.decisions) {
    const option = decision.options.find((candidate) =>
      candidate.adds.some((addition) => addition.id === recordId),
    );
    if (!option) continue;
    const status = decision.choice?.optionId === option.id ? decision.choice.status : "inactive";
    return { decision, option, status };
  }
}

function flowLinks(
  document: BriefDocument,
  index: BriefIndex,
  entityId: BriefEntityId,
): FlowLink[] {
  return index.sectionExhibits.flatMap((flow) => {
    if (flow.kind !== "flow") return [];
    if (!flow.nodes.some((node) => "entity" in node && node.entity === entityId)) return [];
    const nodes = flowGraph(document, flow).stages.flat();
    const node = nodes.find((candidate) => candidate.entity?.id === entityId);
    if (!node) return [];
    const nodesById = new Map(nodes.map((candidate) => [candidate.id, candidate]));
    const link = (connection: FlowConnection, outgoing: boolean): FlowLink[] => {
      const related = nodesById.get(outgoing ? connection.to : connection.from);
      return related ? [{ flow, connection, outgoing, related }] : [];
    };
    return [
      ...node.outgoing.flatMap((connection) => link(connection, true)),
      ...node.incoming.flatMap((connection) => link(connection, false)),
    ];
  });
}
