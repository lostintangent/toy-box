import type { Subprocess } from "bun";

/**
 * Asks a child to exit, with SIGTERM unless the caller has a gentler way, and kills it if
 * it's still running 2 seconds later. Resolves once it has exited, so the server reaps it.
 */
export async function stopProcess(
  child: Pick<Subprocess, "kill" | "exited">,
  ask: () => unknown = () => child.kill(),
): Promise<void> {
  const kill = setTimeout(() => child.kill("SIGKILL"), 2000);
  await ask();
  await child.exited;
  clearTimeout(kill);
}
