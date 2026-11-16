// Seeds a channel's artifacts and tasks through the arm's own ChannelDatabase, imported by path so
// its aliases resolve inside that tree. It follows today's ChannelDatabase API, so a ref older than
// that API can't be seeded.
// Usage, with HOME set to the run's home: bun seed.ts <tree> <channel id> <work folder> <setup JSON>
import { join } from "node:path";
import type { ChannelSetup, SeedTask } from ".";

const [tree, channelId, work, json] = process.argv.slice(2) as [string, string, string, string];
const { artifacts, tasks }: ChannelSetup = JSON.parse(json);
const { getStateDatabase } = await import(join(tree, "src/server/database.ts"));
const { ChannelDatabase } = await import(join(tree, "src/features/channels/server/database.ts"));
const { machineFile, workspaceFileId } = await import(
  join(tree, "src/features/files/model/index.ts")
);
const { readSession } = await import(join(tree, "src/features/sessions/server/state/sessions.ts"));

// The server writes without a busy timeout, so a write beside the lead's start would fail it.
// Recording the lead's provider is the start's last write.
for (let attempt = 0; !(await readSession(channelId))?.provider; attempt++) {
  if (attempt === 1_200) throw new Error("The lead didn't start within two minutes");
  await Bun.sleep(100);
}

const db: Bun.SQL = await getStateDatabase();
await db`PRAGMA busy_timeout = 5000`;
const channels = new ChannelDatabase(db);
const shared: Record<string, string> = {};
for (const [key, { path, title }] of Object.entries(artifacts)) {
  const file = machineFile(join(work, path));
  await channels.shareArtifact({
    channelId,
    file,
    title,
    actor: { type: "agent", agentId: channelId },
  });
  shared[key] = workspaceFileId(file);
}
const task = ({ artifact, children, ...seed }: SeedTask): object => ({
  ...seed,
  ...(artifact && { artifactId: shared[artifact] }),
  ...(seed.status === "done" && { owner: channelId }),
  ...(children && { children: children.map(task) }),
});
await channels.editTasks(channelId, {
  operations: tasks.map((seed) => ({ type: "add", task: task(seed) })),
});
await db.close();
