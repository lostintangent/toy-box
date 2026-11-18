import { $ } from "bun";
import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { endTree } from "./processes";

const folder = mkdtempSync(join(tmpdir(), "evals-processes-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));

const loop = ["/bin/sh", "-c", "while :; do sleep 1; done"];
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

test("ending a tree ends what the root started, however it left, and spares a process beside it", async () => {
  // The root starts a child in its own group and folder, as an agent's detached shell is, and
  // prints its pid. The child leaves an orphan in its group, which launchd now parents. The
  // observer works in the root's folder but isn't the root's.
  const record = join(folder, "orphan");
  const orphaning = ["/bin/sh", "-c", `(sleep 1000 & echo $! > "$1"); ${loop[2]}`, "sh", record];
  const start = `const child = Bun.spawn(${JSON.stringify(orphaning)}, { cwd: "/", detached: true, stdio: ["ignore", "ignore", "ignore"] });
    console.log(child.pid);
    setInterval(() => {}, 1_000);`;
  const root = Bun.spawn([process.execPath, "-e", start], { cwd: folder, stdout: "pipe" });
  const observer = Bun.spawn(loop, { cwd: folder });
  const { value } = await root.stdout.getReader().read();
  const child = Number(new TextDecoder().decode(value));
  const recorded = () =>
    Bun.file(record)
      .text()
      .catch(() => "");
  for (let wait = 0; wait < 20 && !(await recorded()).trim(); wait++) await Bun.sleep(100);
  const orphan = Number(await recorded());
  try {
    expect((await $`ps -o ppid= -p ${orphan}`.text()).trim()).toBe("1");
    await endTree(root.pid);
    await root.exited;
    // The killed child and orphan linger until launchd, their parent now, reaps them.
    for (let wait = 0; wait < 20 && (alive(child) || alive(orphan)); wait++) await Bun.sleep(100);
    expect(alive(child)).toBe(false);
    expect(alive(orphan)).toBe(false);
    const observed = await Promise.race([
      observer.exited.then(() => "ended"),
      Bun.sleep(500).then(() => "running"),
    ]);
    expect(observed).toBe("running");
  } finally {
    observer.kill("SIGKILL");
    for (const pid of [child, orphan]) if (alive(pid)) process.kill(pid, "SIGKILL");
  }
});
