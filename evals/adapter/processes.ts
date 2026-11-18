import { $ } from "bun";

/** Ends a process and every process it started, wherever they moved and whatever group they
 *  joined, and nothing else. Each round stops the processes found so far, so none can start another
 *  unseen, then reads the process table for their children and the members of groups they lead,
 *  until a round finds none. Only then is each killed. A process whose parent exited earlier
 *  belongs to launchd, so it escapes unless it kept a group that one found leads. */
export async function endTree(root: number) {
  const tree = new Set([root]);
  for (let found = [root]; found.length;) {
    for (const pid of found) signal(pid, "SIGSTOP");
    const table = await $`ps -axo pid=,ppid=,pgid=`.quiet().text();
    found = table
      .trim()
      .split("\n")
      .map((line) => line.trim().split(/\s+/).map(Number))
      .filter(([pid, parent, group]) => (tree.has(parent!) || tree.has(group!)) && !tree.has(pid!))
      .map(([pid]) => pid!);
    for (const pid of found) tree.add(pid);
  }
  for (const pid of tree) signal(pid, "SIGKILL");
}

/** Signals a process that may already have exited. */
function signal(pid: number, name: NodeJS.Signals) {
  try {
    process.kill(pid, name);
  } catch {}
}
