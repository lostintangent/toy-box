// The words channel scorecards and scripts are written in: a finished run's turns and calls, its
// lead and members, the channel at any moment and around each step, and its tasks.
import type { ChannelState, ChannelTask } from "@channels/model";
import type { ModelConfiguration } from "@providers/model";
import type { Message, ToolCall } from "@sessions/model";
import { parseUnifiedDiff } from "@sessions/model/fileDiffs";
import type { Run } from "../harness";

/** What a run keeps beside the harness's fields. */
export type Evidence = {
  /** The channel as seeded, at each lead rest, before each step, and at the end. Only the last
   *  keeps its messages. */
  snapshots: { at: string; state: ChannelState }[];
  agents: Agent[];
  /** The work's changes from the fixture when the run ended, as a unified diff. */
  work: string;
};

export type Agent = {
  id: string;
  name: string;
  model?: ModelConfiguration;
  /** When the server started each of its runs, and when each came to rest. */
  runs: string[];
  rests: string[];
  /** Its canonical transcript, complete from the first message. */
  messages: Message[];
};

export type Call = {
  name: string;
  args: Record<string, any>;
  result: string;
  failed: boolean;
  /** The lines a file edit added to the work, read from the diff every provider reports. A shell
   *  command's writes report none. */
  added: string[];
};

/** One run of an agent, from waking to rest. A wake delivered while it ran stays in it. */
export type Turn = { agent: string; at: number; end?: number; inputs: Message[]; calls: Call[] };

export type ChannelView = {
  run: Run & Evidence;
  lead: Turn[];
  members: Turn[];
  final?: ChannelState;
  /** The tasks the channel started with. */
  seeded: Set<string>;
  /** The lines the work gained by the end, whatever wrote them. */
  added: string[];
  /** Minutes to the lead's first rest, and from the start to the end. */
  kickoff?: number;
  minutes: number;
  /** The channel at any moment of the run. */
  channel(at: number): ChannelState | undefined;
  /** The lead's turns that handled a step, and the channel before and after them. */
  step(id: string): { before?: ChannelState; turns: Turn[]; after: ChannelState } | undefined;
};

export function view(record: Run): ChannelView {
  const run = record as Run & Evidence;
  const final = run.snapshots.at(-1)?.state;
  const agent = (id?: string) => run.agents.find((candidate) => candidate.id === id);
  const lead = turns(agent(final?.channel.id));
  const rests = (agent(final?.channel.id)?.rests ?? []).map(Date.parse);
  const started = Date.parse(run.startedAt);
  const channel = (at: number) =>
    run.snapshots.filter((snapshot) => Date.parse(snapshot.at) <= at).at(-1)?.state;
  return {
    run,
    lead,
    members: (final?.members ?? []).flatMap((member) => turns(agent(member.id))),
    final,
    seeded: new Set(walk(run.snapshots[0]?.state.channel.tasks).map(({ task }) => task.id)),
    added: additions(run.work),
    kickoff: rests[0] === undefined ? undefined : (rests[0] - started) / 60_000,
    minutes: (Date.parse(run.endedAt) - started) / 60_000,
    channel,
    step(id) {
      // Kickoff starts from the channel as seeded, and a step from the channel just before it.
      const sent = run.steps.find((step) => step.id === id);
      const at = Date.parse(sent?.at ?? run.startedAt);
      const end = rests.find((rest) => rest > at);
      const after = end === undefined ? undefined : channel(end);
      if (!after || (id !== "kickoff" && !sent)) return undefined;
      const before = sent ? channel(at) : run.snapshots[0]?.state;
      return { before, turns: lead.filter((turn) => turn.at > at && turn.end === end), after };
    },
  };
}

/** Splits a transcript at the server's run starts. The server records a wake just before it starts
 *  the run it wakes, so an input belongs to the last run that began no more than a second after it. */
export function turns(agent: Agent | undefined): Turn[] {
  if (!agent) return [];
  const rests = agent.rests.map(Date.parse);
  const result: Turn[] = agent.runs.map(Date.parse).map((at) => ({
    agent: agent.name,
    at,
    end: rests.find((rest) => rest >= at),
    inputs: [],
    calls: [],
  }));
  let turn: Turn | undefined;
  for (const message of agent.messages) {
    if (message.role === "assistant") {
      turn?.calls.push(...(message.toolCalls ?? []).map(call));
      continue;
    }
    const at = Date.parse(message.timestamp ?? "");
    turn = result.filter((candidate) => candidate.at <= at + 1_000).at(-1) ?? turn ?? result[0];
    turn?.inputs.push(message);
  }
  return result;
}

function call({ name, arguments: args, result }: ToolCall): Call {
  const edit = ["create", "edit", "patch"].includes(name) && result?.success && result.details;
  return {
    name: name.replace(/^mcp__.+?__/, ""),
    args,
    result: result?.content ?? "",
    failed: result?.success === false,
    added: edit ? additions(edit) : [],
  };
}

const additions = (diff: string) =>
  parseUnifiedDiff(diff).flatMap((file) =>
    file.hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.type === "added").map((line) => line.text),
    ),
  );

export const calls = (turns: Turn[], name?: string) =>
  turns.flatMap((turn) => turn.calls).filter((call) => !name || call.name === name);

/** A turn cut off by the end of the run has no rest, so rules about whole turns skip it. */
export const complete = (turns: Turn[]) => turns.filter((turn) => turn.end !== undefined);

/** Every tool a channel agent or session can call, for rules about calling them correctly. */
export const channelTools = new Set(
  `read_channel set_agent_status react_to_channel_message share_channel_artifact finish_agent_turn
  send_channel_message create_channel_members update_channel_member remove_channel_member update_member
  update_channel edit_channel_tasks set_routine delete_routine remove_channel_artifact message_channel_lead
  list_channels create_channel post_channel_message wait_for_channel_agents`.split(/\s+/),
);

export type Node<Task = ChannelTask> = { task: Task; parent?: Task; depth: number };

/** Every task at any depth, with its parent and depth. */
export const walk = <Task extends { children?: Task[] }>(
  list: Task[] = [],
  parent?: Task,
  depth = 0,
): Node<Task>[] =>
  list.flatMap((task) => [{ task, parent, depth }, ...walk(task.children, task, depth + 1)]);

/** A channel's tasks by id. */
export const tree = (state?: ChannelState) =>
  new Map(walk(state?.channel.tasks).map((node) => [node.task.id, node]));

/** Added by an agent: not seeded and not the user's. A task read from the channel is owned by an
 *  actor, and a task in a tool call by a handle. */
export const organic = (task: any, seeded: Set<string>) =>
  !seeded.has(task.id) && task.owner?.type !== "user" && task.owner !== "@user";

/** The tasks as each successful task write in these turns left them, with the tasks before it. A
 *  removed task keeps its last fields, so work marked done and removed in one call counts as done
 *  with whatever it carried. */
export function* writes(turns: Turn[]) {
  const tasks = new Map<string, any>();
  for (const { name, args, failed } of calls(turns)) {
    if (failed || !(name === "edit_channel_tasks" || (name === "update_channel" && args.tasks)))
      continue;
    const before = new Map(tasks);
    for (const { task } of walk<any>(args.tasks)) tasks.set(task.id, task);
    for (const op of args.operations ?? []) {
      if (op.type === "add") for (const { task } of walk<any>([op.task])) tasks.set(task.id, task);
      if (op.type === "update")
        tasks.set(op.taskId, { ...tasks.get(op.taskId), ...op.patch, id: op.taskId });
    }
    yield { before, tasks };
  }
}
