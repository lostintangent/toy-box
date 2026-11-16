// What a channel-lead run is held to. Each criterion encodes a decision the user made about how
// channel agents work, or a rule that has separated arms, and each measure is a number a comparison
// has asked for. Changing one rescores old runs, with no revision bump.
import type { ChannelTask } from "@channels/model";
import type { Scorecard } from "../harness";
import {
  type Call,
  type ChannelView,
  calls,
  channelTools,
  complete,
  type Node,
  organic,
  type Turn,
  tree,
  turns,
  walk,
  writes,
} from "../adapter/view";

export default {
  criteria: [
    // The purpose reserves the storage decision for the user.
    {
      id: "Q1",
      step: "run",
      governs: "Requests: ask before the answer is needed, with 2 to 4 replies",
      check: (view) => {
        const turn = request(view);
        if (!turn || turn.at >= (Date.parse(sentAt(view, "M2") ?? "") || Infinity))
          return "no request before M2";
        const replies = turn.calls.find(isRequest)!.args.replies?.length ?? 0;
        return (replies >= 2 && replies <= 4) || `${replies} replies`;
      },
    },
    {
      id: "Q2",
      step: "run",
      governs: "Requests: track the ask as a pending task owned by the user",
      check: (view) => {
        const turn = request(view);
        // Q1 already misses a run that never asks.
        if (!turn) return null;
        return (
          walk(view.channel(turn.end ?? -Infinity)?.channel.tasks).some(
            ({ task }) => task.owner?.type === "user" && task.status === "pending",
          ) || "no pending @user task"
        );
      },
    },
    {
      id: "Q3",
      step: "M2",
      governs: "Requests: an answer closes the ask without asking again",
      check: (view) => {
        const { before, after, turns } = view.step("M2")!;
        const [now, wrote] = [tree(after), [...writes(turns)].at(-1)?.tasks];
        const asks = walk(before?.channel.tasks).filter(
          ({ task }) => task.owner?.type === "user" && task.status !== "done",
        );
        const again = calls(turns).some(isRequest);
        // Asking again misses even when nothing tracked the first ask.
        if (!asks.length && !again) return null;
        const open = asks.filter(({ task }) =>
          now.has(task.id)
            ? now.get(task.id)!.task.status !== "done"
            : wrote?.get(task.id)?.status !== "done" && !recorded(turns, task.id, outcomes.storage),
        );
        return fail([
          ...open.map(({ task }) =>
            now.has(task.id)
              ? `${task.id} left open`
              : `${task.id} removed without marking done or recording the answer`,
          ),
          ...(again ? ["asked again"] : []),
        ]);
      },
    },
    {
      id: "S1",
      step: "run",
      governs: "Staff: a role of 100 to 200 words",
      check: ({ lead }) => {
        const words = roles(lead).map((role) => role.split(/\s+/).filter(Boolean).length);
        return words.length
          ? words.every((count) => count >= 100 && count <= 200) || `words ${words.join(", ")}`
          : null;
      },
    },
    // The first planned task the lead marks done, at any depth, because the rule covers every task
    // it verifies. Read from its writes, since a task can be marked done and removed in one call.
    {
      id: "D1",
      step: "run",
      governs: "Track and adapt: finished work links its artifact or diff",
      check: ({ lead, seeded }) => {
        for (const { before, tasks } of writes(lead))
          for (const task of tasks.values())
            if (
              task.status === "done" &&
              before.get(task.id)?.status !== "done" &&
              planned(task, seeded)
            )
              return !!(task.artifactId || task.diff) || `${task.id} links nothing`;
        return null;
      },
    },
    {
      id: "R1",
      step: "M3",
      governs: "Track and adapt: regroup without losing or rewriting tasks",
      check: (view) => regrouped(view),
    },
    {
      id: "U1",
      step: "M4",
      governs: "Routines: one routine once asked, leaving the purpose and tasks alone",
      check: (view) => {
        const { before, after } = view.step("M4")!;
        const late = view.lead.filter((turn) => turn.at > Date.parse(sentAt(view, "M4")!));
        const routines = (turns: Turn[]) => calls(turns, "set_routine").length;
        return fail([
          ...(routines(view.lead) === 1 && routines(late) ? [] : ["not one routine after M4"]),
          ...(before?.channel.purpose === after.channel.purpose ? [] : ["purpose changed"]),
          ...walk(after.channel.tasks)
            .filter(({ task }) => !tree(before).has(task.id))
            .map(({ task }) => `added ${task.id}`),
        ]);
      },
    },
    // Done work stays until its outcome is recorded elsewhere, and then it retires.
    {
      id: "N1",
      step: "run",
      governs: "Track and adapt: done work stays until its outcome is recorded elsewhere",
      // The work saying it at the end is enough, whatever wrote it and whenever (Channels 5884).
      check: ({ final, added }) =>
        tree(final).has("npm") ||
        added.some((line) => outcomes.npm.test(line)) ||
        "npm removed without recording its outcome",
    },
    {
      id: "N2",
      step: "run",
      governs: "Track and adapt: done work whose outcome is recorded retires",
      check: ({ final }) => !tree(final).has("survey"),
    },
    // Every whole turn, the lead's (T1, T2) and the members' (T1.m, T2.m) scored apart.
    {
      id: "T1",
      step: "run",
      governs: "Every turn: end with finish_agent_turn",
      check: ({ lead }) => everyTurn(lead, unfinished),
    },
    {
      id: "T2",
      step: "run",
      governs: "Every turn: channel tools called correctly",
      check: ({ lead }) => everyTurn(lead, failures),
    },
    {
      id: "T1.m",
      step: "run",
      governs: "Every turn: end with finish_agent_turn",
      check: ({ members }) => everyTurn(members, unfinished),
    },
    {
      id: "T2.m",
      step: "run",
      governs: "Every turn: channel tools called correctly",
      check: ({ members }) => everyTurn(members, failures),
    },
    {
      id: "T3.m",
      step: "run",
      governs: "Finish: a member's wait always sets a wake",
      check: ({ members }) =>
        everyTurn(members, (turns) =>
          calls(turns, "finish_agent_turn")
            .filter(({ args }) => args.waitingFor && !args.wakeAfterMinutes)
            .map(({ args }) => String(args.waitingFor)),
        ),
    },
  ],
  measures: [
    {
      id: "kickoff",
      description: "Minutes to the lead's first rest",
      measure: ({ kickoff }) => kickoff,
    },
    {
      id: "minutes",
      description: "Minutes from the start to the end",
      measure: ({ minutes }) => minutes,
    },
    {
      id: "failed",
      description: "Failed channel tool calls, by the lead and members",
      measure: ({ lead, members }) => failed([...lead, ...members]).length,
    },
    ...(["edit_channel_tasks", "update_channel"] as const).map((tool) => ({
      id: `failed.${tool}`,
      description: `Failed ${tool} calls, by the lead and members`,
      measure: ({ lead, members }: ChannelView) =>
        failed([...lead, ...members]).filter(({ name }) => name === tool).length,
    })),
    ...(["add", "update", "move", "remove"] as const).map((kind) => ({
      id: `tasks.${kind}`,
      description: `Successful ${kind} operations in edit_channel_tasks calls, by the lead and members`,
      measure: ({ lead, members }: ChannelView) =>
        calls([...lead, ...members], "edit_channel_tasks")
          .filter((call) => !call.failed)
          .flatMap((call) => call.args.operations ?? [])
          .filter((operation: { type: string }) => operation.type === kind).length,
    })),
  ],
} satisfies Scorecard<ChannelView>;

/** Channels' rule for retiring a task: it closes once marked done, or once removed after the work
 *  records its outcome. Recorded means a file edit in these turns, which start once the outcome
 *  exists, added a line saying it before the call that removed the task. Only the lead's own file
 *  edits are ordered against its removal, so a member's edit or a shell write doesn't count. */
function recorded(turns: Turn[], id: string, outcome: RegExp) {
  for (const call of calls(turns)) {
    if (removes(call, id)) return false;
    if (call.added.some((line) => outcome.test(line))) return true;
  }
  return false;
}
const removes = ({ name, args, failed }: Call, id: string) =>
  !failed &&
  ((name === "edit_channel_tasks" &&
    args.operations?.some((op: any) => op.type === "remove" && op.taskId === id)) ||
    (name === "update_channel" &&
      args.tasks &&
      !walk<any>(args.tasks).some(({ task }) => task.id === id)));
/** What the work says once it records the user's storage answer, or the spike's npm check. */
const outcomes = { storage: /notes\.json/i, npm: /\bname\b.*\bnpm\b|\bnpm\b.*\bname\b/i };
const milestone = /^\s*(design|build)\b/i;
/** Work the lead planned and can finish, which leaves out the milestones that group it. */
const planned = (task: any, seeded: Set<string>) =>
  organic(task, seeded) && !/^(design|build)$/i.test(task.title?.trim() ?? "");
/** Paths under the macOS temporary folder show up both with and without /private. */
const comparable = (value: unknown) => `${JSON.stringify(value)}`.replaceAll("/private/", "/");
const same = (left: unknown, right: unknown) => comparable(left) === comparable(right);
const sentAt = (view: ChannelView, id: string) => view.run.steps.find((sent) => sent.id === id)?.at;
const isRequest = (call: Call) => call.name === "send_channel_message" && !!call.args.request;
const request = (view: ChannelView) => view.lead.find((turn) => turn.calls.some(isRequest));
const fail = (problems: string[]) => !problems.length || problems.join("; ");
const label = (turn: Turn) => `${turn.agent}@${new Date(turn.at).toISOString().slice(11, 19)}`;
const failed = (turns: Turn[]) =>
  calls(turns).filter((call) => channelTools.has(call.name) && call.failed);
const failures = (turns: Turn[]) =>
  failed(turns).map((call) => `${call.name}: ${call.result.slice(0, 200)}`);
const unfinished = (turns: Turn[]) =>
  turns.filter((turn) => turn.calls.at(-1)?.name !== "finish_agent_turn").map(label);
const roles = (lead: Turn[]): string[] => [
  ...calls(lead, "create_channel_members").flatMap(({ args }) =>
    (args.members ?? []).map((member: any) => String(member.role ?? "")),
  ),
  ...calls(lead, "update_channel_member").flatMap(({ args }) =>
    args.role ? [String(args.role)] : [],
  ),
];

/** A rule over whole turns, which doesn't apply until there is one. */
function everyTurn(turns: Turn[], check: (turns: Turn[]) => string[]) {
  return complete(turns).length ? fail(check(complete(turns))) : null;
}

/** Every task from before M3 survives unchanged, except a wrapper whose children all moved under a
 *  milestone, which may go or become that milestone, and a task whose status catches up with a
 *  member's report or with an owner who was working during the step. */
function regrouped(view: ChannelView) {
  const { before, after, turns: handling } = view.step("M3")!;
  const [pre, post] = [tree(before), tree(after)];
  const [from, to] = [Date.parse(sentAt(view, "M3")!), handling.at(-1)?.end ?? Infinity];
  const working = ({ task }: Node) => {
    const owner = task.owner?.type === "agent" ? task.owner.agentId : undefined;
    return turns(view.run.agents.find((agent) => agent.id === owner)).some(
      (turn) => turn.at < to && (turn.end ?? Infinity) > from,
    );
  };
  const reported = handling.some((turn) =>
    turn.inputs.some(
      (input) =>
        input.role === "system" &&
        input.content.type === "channel_message" &&
        input.content.senderName !== "the user",
    ),
  );
  const underMilestone = (id: string) =>
    post.get(id)?.depth === 1 && milestone.test(post.get(id)!.parent!.title);
  const wrapper = ({ task }: Node) =>
    !!task.children?.length &&
    !task.artifactId &&
    !task.diff &&
    task.children.every((child) => underMilestone(child.id)) &&
    (!task.owner || task.children.every((child) => same(child.owner, task.owner)));
  const allowed = (node: Node) => {
    const reused = post.get(node.task.id)?.task;
    const lead =
      !reused?.owner || same(reused.owner, { type: "agent", agentId: view.final?.channel.id });
    const milestoned =
      wrapper(node) && post.get(node.task.id)?.depth === 0 && milestone.test(reused!.title) && lead;
    return [
      "title",
      "diff",
      ...(reported || working(node) ? ["status", "startedAt"] : []),
      ...(milestoned ? ["owner"] : []),
    ];
  };
  const lost = [...pre.values()]
    .filter((node) => !post.has(node.task.id) && !wrapper(node))
    .map(({ task }) => task.id);
  const changed = [...pre.values()].flatMap((node) =>
    (
      [
        "title",
        "status",
        "owner",
        "artifactId",
        "diff",
        "startedAt",
      ] as const satisfies (keyof ChannelTask)[]
    )
      .filter(
        (field) =>
          post.has(node.task.id) && !same(node.task[field], post.get(node.task.id)!.task[field]),
      )
      .filter((field) => !allowed(node).includes(field))
      .map((field) => `${node.task.id}.${field}`),
  );
  const top = (word: string) =>
    after.channel.tasks.find((task) => task.title.trim().toLowerCase().startsWith(word));
  return fail([
    ...(lost.length ? [`lost ${lost.join(", ")}`] : []),
    ...(changed.length ? [`changed ${changed.join(", ")}`] : []),
    ...(top("design") && top("build") ? [] : ["milestones missing"]),
    ...(top("build") && post.get("help")?.parent?.id === top("build")!.id
      ? []
      : ["help not under Build"]),
  ]);
}
