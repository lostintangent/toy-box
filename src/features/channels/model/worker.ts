// Interpret opaque Worker metadata as Channel identity and collaboration state.
import type { Worker } from "@workers/model";
import {
  channelAgentMetadataSchema,
  channelLead,
  compareChannelAgents,
  type ChannelMember,
} from "./index";

export function isChannelLead(worker: Extract<Worker, { type: "channel" }>): boolean {
  return worker.sessionId === worker.channelId;
}

export function channelAgentFromWorker(worker: Extract<Worker, { type: "channel" }>) {
  const metadata = channelAgentMetadataSchema.parse(worker.metadata);
  const context = { channelId: worker.channelId, seenThrough: metadata.seenThrough };
  return isChannelLead(worker)
    ? { ...channelLead(worker.sessionId, metadata.status), ...context, isLead: true as const }
    : { ...channelMemberFromWorker(worker, metadata), ...context, isLead: false as const };
}

export type ChannelAgentContext = ReturnType<typeof channelAgentFromWorker>;

export function channelRoster(workers: Extract<Worker, { type: "channel" }>[]) {
  const lead = workers.find(isChannelLead);
  if (!lead) throw new Error("Channel lead is incomplete.");
  return {
    lead: channelLead(lead.sessionId, channelAgentMetadataSchema.parse(lead.metadata).status),
    members: channelMembersFromWorkers(workers),
  };
}

export function channelMembersFromWorkers(workers: Extract<Worker, { type: "channel" }>[]) {
  return workers
    .filter((worker) => !isChannelLead(worker))
    .map((worker) => channelMemberFromWorker(worker))
    .sort(compareChannelAgents);
}

export function channelMemberFromWorker(
  worker: Extract<Worker, { type: "channel" }>,
  metadata = channelAgentMetadataSchema.parse(worker.metadata),
): ChannelMember {
  if (!worker.name) throw new Error("Channel members require a name.");
  const { seenThrough: _seenThrough, ...profile } = metadata;
  return { channelId: worker.channelId, id: worker.sessionId, name: worker.name, ...profile };
}
