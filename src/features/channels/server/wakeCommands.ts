import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Subprocess } from "bun";
import { sessionArtifactsDirectory } from "@sessions/server/artifacts";
import { sharedMap } from "@/shared/server/processState";

/** The wake command each channel agent is running on this server, at most one per agent. */
const commands = sharedMap<{ command: string; child: Subprocess }>("channel-wake-commands");

/** Where an agent's wake command writes its output, in the agent's session state folder. */
export function wakeCommandOutput(agentId: string) {
  const folder = dirname(sessionArtifactsDirectory(agentId));
  return { stdout: join(folder, "command.stdout"), stderr: join(folder, "command.stderr") };
}

/**
 * Runs an agent's wake command in its own process group, replacing the one it was running. When it
 * exits on its own, it leaves the map and calls `onExit` in the same step, with a null exit code
 * when a signal ended it. A stopped or replaced command never calls it.
 */
export function runWakeCommand(
  agentId: string,
  command: string,
  cwd: string,
  onExit: (exitCode: number | null) => void,
) {
  void stopWakeCommand(agentId);
  // Bun opens output files without truncating them.
  const output = wakeCommandOutput(agentId);
  for (const path of Object.values(output)) rmSync(path, { force: true });
  const child = Bun.spawn([process.env.SHELL || "bash", "-c", command], {
    cwd,
    stdin: "ignore",
    stdout: Bun.file(output.stdout),
    stderr: Bun.file(output.stderr),
    detached: true,
  });
  // This server never writes to the watcher, so if it dies without stopping the command, the
  // watcher reads the end of its input and kills the group the same way `stopWakeCommand` does.
  const watcher = Bun.spawn(
    ["sh", "-c", `read _; kill -STOP -${child.pid}; kill -KILL -${child.pid}`],
    { stdin: "pipe", stdout: "ignore", detached: true },
  );
  commands.set(agentId, { command, child });
  void child.exited.then(() => {
    watcher.kill();
    if (commands.get(agentId)?.child !== child) return;
    commands.delete(agentId);
    onExit(child.exitCode);
  });
}

/**
 * Kills an agent's wake command and everything it started, without a wake. A shell can outlive a
 * catchable signal and run its next step, and macOS signals a group one process at a time, so the
 * group is frozen before it's killed.
 */
export async function stopWakeCommand(agentId: string): Promise<void> {
  const { child } = commands.get(agentId) ?? {};
  if (!child) return;
  commands.delete(agentId);
  for (const signal of ["SIGSTOP", "SIGKILL"] as const) {
    try {
      process.kill(-child.pid, signal);
    } catch (error) {
      // The group may be gone already, as when the command exits right as it's killed.
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  }
  await child.exited;
}

/** Whether an agent's wake command is running in this process, which a dev reload keeps. */
export function isWakeCommandRunning(agentId: string): boolean {
  return commands.has(agentId);
}

export async function stopWakeCommands(): Promise<void> {
  await Promise.all([...commands.keys()].map(stopWakeCommand));
}
