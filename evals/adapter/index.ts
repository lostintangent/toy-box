// Toy Box as the system under test: a server of the arm's tree in each run's sandbox, a channel
// whose lead's rests drive the script, and the channel and every agent's transcript read back.
import { $ } from "bun";
import { Database } from "bun:sqlite";
import { chmodSync, closeSync, openSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { EventSourceParserStream } from "eventsource-parser/stream";
import type { ChannelState } from "@channels/model";
import type { SessionState, SessionSubscriptionEvent } from "@sessions/model";
import { joinPreviousMessages } from "@sessions/model/transcriptPages";
import type { WorkspaceEvent } from "@workspace/model/events";
import type { Adapter, Arm, Sandbox, System } from "../harness";
import { calls, type ChannelView, type Evidence, turns, view, walk } from "./view";

/** A channel to start: work folder files to share as artifacts, by key, and tasks to seed. A done
 *  seed is the lead's, and `artifact` names one of the keys. */
export type ChannelSetup = {
  name: string;
  purpose: string;
  artifacts: Record<string, { path: string; title: string }>;
  tasks: SeedTask[];
};
export type SeedTask = {
  id: string;
  title: string;
  status: "pending" | "done";
  artifact?: string;
  children?: SeedTask[];
};

export default {
  async build(tree) {
    await $`bun install --frozen-lockfile && bun run build`.cwd(tree).quiet();
  },

  async start(arm, sandbox, setup) {
    // Found ahead of the real one on PATH, so no server reaches the tailnet.
    await Bun.write(
      join(sandbox.bin, "tailscale"),
      `#!/bin/sh\necho '{"Self":{"UserID":0},"Peer":null}'\n`,
    );
    chmodSync(join(sandbox.bin, "tailscale"), 0o755);
    const server = await serve(arm, sandbox);
    try {
      const unoffered = await offered(server, arm);
      if (unoffered) {
        await server.stop();
        return unoffered;
      }
      const stream = server.events<WorkspaceEvent>("/api/workspace", sandbox.signal);
      await stream.next(); // Subscribed before anything starts, so no rest goes unseen.
      const { name, purpose } = setup;
      const channel = { name, purpose, directory: sandbox.work, model: model(arm) };
      const { id } = await server.json("/api/v1/channels", channel);
      const seed = [
        join(import.meta.dir, "seed.ts"),
        arm.tree,
        id,
        sandbox.work,
        JSON.stringify(setup),
      ];
      const seeded = await $`${process.execPath} ${seed}`.env(sandbox.env).quiet().nothrow();
      if (seeded.exitCode) throw new Error(`Seeding failed: ${seeded.stderr.toString().trim()}`);
      return await live(server, stream, id, arm, sandbox, setup);
    } catch (error) {
      await server.stop();
      throw error;
    }
  },

  view,
} satisfies Adapter<ChannelSetup, ChannelState, ChannelView>;

/** A run's channel, live. It snapshots the channel at every lead rest and before each message,
 *  joins each agent's transcript as it rests, and keeps the work's changes at the end. */
async function live(
  server: Server,
  stream: AsyncGenerator<WorkspaceEvent>,
  lead: string,
  arm: Arm,
  sandbox: Sandbox,
  setup: ChannelSetup,
): Promise<System<ChannelState>> {
  const evidence: Evidence = { snapshots: [], agents: [], work: "" };
  const agents = new Map<string, { runs: string[]; rests: string[]; state?: SessionState }>();
  const running = new Set<string>();
  let [lastSend, lastRest] = [Date.now(), 0];
  let pending: Promise<IteratorResult<WorkspaceEvent>> | undefined;

  const snapshot = async (at = Date.now()) => {
    const { state } = await server.first<{ state: ChannelState }>(`/api/v1/channels/${lead}`);
    const last = evidence.snapshots.at(-1);
    if (last) last.state = { ...last.state, messages: [] };
    evidence.snapshots.push({ at: iso(at), state });
  };
  // Joined onto what it already had, so a transcript longer than one page stays whole.
  const transcript = async (id: string) => {
    const event = await server.first<SessionSubscriptionEvent>(`/api/sessions/${id}`);
    if (event.type !== "snapshot")
      throw new Error(`Session ${id} sent ${event.type} before its snapshot`);
    const agent = agents.get(id) ?? { runs: [], rests: [] };
    const state = agent.state ? joinPreviousMessages(agent.state, event.state) : event.state;
    agents.set(id, { ...agent, state });
  };
  const name = (id: string) =>
    id === lead
      ? "lead"
      : (evidence.snapshots.at(-1)?.state.members.find((member) => member.id === id)?.name ?? id);
  // Returns whether the lead just came to rest, after recording the channel at that moment.
  const observe = async (event: WorkspaceEvent) => {
    if (!event.type.startsWith("session.") || !("sessionId" in event)) return false;
    const id = event.sessionId;
    const agent = agents.get(id) ?? { runs: [], rests: [] };
    agents.set(id, agent);
    if (event.type === "session.running") {
      if (!running.has(id)) agent.runs.push(iso(event.at));
      running.add(id);
      return false;
    }
    if (!running.delete(id)) return false;
    const at = Date.now();
    agent.rests.push(iso(at));
    if (id === lead) await snapshot((lastRest = at));
    await transcript(id);
    return id === lead;
  };

  await snapshot();
  return {
    async settle(ms) {
      const deadline = Date.now() + ms;
      for (let rested = false; !rested;) {
        // Requested only as it's raced, so the reset when the server stops rejects a handled promise.
        pending ??= stream.next();
        // Unreferenced, so a tick still pending when the run ends doesn't hold the process open.
        const result = await Promise.race([
          pending,
          sleep(deadline - Date.now(), undefined, { ref: false }),
        ]);
        if (!result) break;
        pending = undefined;
        if (result.done) throw new Error("The workspace stream ended");
        rested = await observe(result.value);
      }
      return !running.has(lead) && lastRest >= lastSend
        ? evidence.snapshots.at(-1)!.state
        : undefined;
    },
    async send(content) {
      const at = Date.now();
      await snapshot((lastSend = at));
      await server.json(`/api/v1/channels/${lead}/messages`, { id: crypto.randomUUID(), content });
      return iso(at);
    },
    async end() {
      if (server.alive()) {
        await snapshot().catch(() => {});
        const members = evidence.snapshots.at(-1)?.state.members.map(({ id }) => id) ?? [];
        for (const id of new Set([lead, ...members])) await transcript(id).catch(() => {});
      }
      await server.stop();
      const work = await changes(sandbox).catch(() => undefined);
      evidence.work = work ?? "";
      evidence.agents = [...agents].flatMap(([id, { runs, rests, state }]) =>
        state
          ? [{ id, name: name(id), model: state.model, runs, rests, messages: state.messages }]
          : [],
      );
      const reason = work === undefined ? "the work couldn't be read" : undefined;
      return { evidence, invalid: reason ?? invalid(evidence, agents, lead, arm, setup) };
    },
  };
}

/** Why a completed run can't be compared: a transcript that couldn't be joined whole, a lead on
 *  another model, or a lead whose first read of the channel missed a seed (the seed race). */
function invalid(
  evidence: Evidence,
  agents: Map<string, { state?: SessionState }>,
  lead: string,
  arm: Arm,
  setup: ChannelSetup,
) {
  const gap = [...agents].find(([, agent]) => agent.state?.messageOffset);
  if (gap) return `transcript gap in ${gap[0]}`;
  const leader = evidence.agents.find(({ id }) => id === lead);
  if (leader && (leader.model?.provider !== arm.provider || leader.model?.name !== arm.model))
    return `model, the lead ran ${leader.model?.provider}/${leader.model?.name}`;
  const read = calls(turns(leader), "read_channel")[0]?.result.replaceAll("\\", "") ?? "";
  const seeds = walk(setup.tasks).map(({ task }) => task.id);
  return seeds.every((id) => read.includes(`"id":"${id}"`)) ? undefined : "seed race";
}

/** The work's files as they ended against the fixture's commit, as one diff, so whatever wrote
 *  them, a shell command included, shows. A throwaway index leaves the agents' own alone. */
async function changes({ work, env, tmp }: Sandbox) {
  const index = { ...env, GIT_INDEX_FILE: join(tmp, "changes.index") };
  const git = (...args: string[]) => $`git ${args}`.cwd(work).env(index).quiet().text();
  const [fixture] = (await git("rev-list", "--max-parents=0", "HEAD")).split("\n");
  await git("add", "-A", "--", ".", ":(exclude)node_modules");
  return await git("diff", "--cached", "--no-color", "--no-ext-diff", fixture!);
}

type Server = {
  alive(): boolean;
  json(path: string, body?: unknown): Promise<any>;
  events<Event>(path: string, signal: AbortSignal): AsyncGenerator<Event>;
  /** The first event of a stream, for routes that only serve SSE. */
  first<Event>(path: string): Promise<Event>;
  /** SIGKILL to the whole process group, since the sandbox it ran in is about to go. */
  stop(): Promise<void>;
};

/** Starts the tree's server in the sandbox on a free port that's never 3100, in its own process
 *  group, sets the member default to the arm's model and turns the other providers off before
 *  anything starts a session, then returns once the arm's models are known. */
async function serve(arm: Arm, sandbox: Sandbox): Promise<Server> {
  const port = freePort();
  const base = `http://127.0.0.1:${port}`;
  const fd = openSync(join(sandbox.out, "server.log"), "a");
  const argv = ["src/cli/index.ts", "--port", String(port), "--host", "127.0.0.1", "--no-open"];
  const child = Bun.spawn([process.execPath, ...argv], {
    cwd: arm.tree,
    env: sandbox.env,
    detached: true,
    stdio: ["ignore", fd, fd],
  });
  closeSync(fd);
  const server: Server = {
    alive: () => child.exitCode === null && !child.signalCode,
    json: (path, body) => json(`${base}${path}`, body),
    events: (path, signal) => events(`${base}${path}`, signal),
    async first(path) {
      for await (const event of events<any>(`${base}${path}`, AbortSignal.timeout(60_000)))
        return event;
      throw new Error(`${path} closed before its first event`);
    },
    async stop() {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
      await child.exited;
    },
  };
  // Polled, since a cold answer can outlast Bun's 10 s idle timeout, which drops the request.
  const answers = async (path: string) => {
    for (let attempt = 0; !(await server.json(path).catch(() => false)); attempt++) {
      if (!server.alive() || attempt === 180)
        throw new Error("The server didn't start; see server.log");
      await Bun.sleep(1_000);
    }
  };
  try {
    await answers("/api/v1/channels");
    const db = new Database(join(sandbox.home, ".toy-box/toy-box.sqlite"));
    const disabledProviders = ["claude", "codex", "copilot"].filter(
      (name) => name !== arm.provider,
    );
    db.run("PRAGMA busy_timeout = 5000");
    db.run(
      "INSERT INTO settings (id, value) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET value = json_patch(value, excluded.value)",
      [JSON.stringify({ defaultModel: model(arm), disabledProviders })],
    );
    db.close();
    // Only now, so discovery starts the arm's provider alone.
    await answers("/api/v1/models");
    return server;
  } catch (error) {
    await server.stop();
    throw error;
  }
}

/** Why the arm can't run as asked: its own server doesn't offer its model and effort. */
async function offered(server: Server, arm: Arm) {
  const { models } = await server.json("/api/v1/models");
  const listed = models.find(
    (candidate: any) => candidate.provider === arm.provider && candidate.id === arm.model,
  );
  if (!listed || (arm.effort && !listed.supportedReasoningEfforts?.includes(arm.effort)))
    return `${arm.provider}/${arm.model}${arm.effort ? `@${arm.effort}` : ""} isn't offered by this arm's server`;
}

const model = ({ provider, model, effort }: Arm) => ({
  provider,
  name: model,
  ...(effort && { reasoningEffort: effort }),
});

function freePort(): number {
  const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  probe.stop(true);
  return probe.port === 3100 ? freePort() : probe.port;
}

async function json(url: string, body?: unknown) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(60_000),
    ...(body !== undefined && {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  });
  if (!response.ok) throw new Error(`${url}: ${response.status} ${await response.text()}`);
  return response.json();
}

async function* events<Event>(url: string, signal: AbortSignal): AsyncGenerator<Event> {
  // Identity, because the server gzips event streams for browsers.
  const headers = { accept: "text/event-stream", "accept-encoding": "identity" };
  const response = await fetch(url, { headers, signal });
  if (!response.ok || !response.body) throw new Error(`${url}: ${response.status}`);
  const stream = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream());
  for await (const { data } of stream) yield JSON.parse(data);
}

const iso = (ms: number) => new Date(ms).toISOString();
