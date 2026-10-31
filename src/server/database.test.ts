import { expect, onTestFinished, test } from "bun:test";
import { migrate } from "./database";

const createNotes = `CREATE TABLE IF NOT EXISTS notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)`;
const addPinned = `ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0`;

function openDatabase(): Bun.SQL {
  const db = new Bun.SQL({ adapter: "sqlite", filename: ":memory:", strict: true });
  onTestFinished(() => db.close());
  return db;
}

async function columns(db: Bun.SQL): Promise<string[]> {
  const rows = await db<{ name: string }[]>`SELECT name FROM pragma_table_info('notes')`;
  return rows.map(({ name }) => name);
}

test("an upgrade runs only the versions it hasn't seen and keeps its rows", async () => {
  const db = openDatabase();
  await migrate(db, { notes: [createNotes] });
  await db`INSERT INTO notes (id, body) VALUES ('n1', 'hello')`;

  await migrate(db, { notes: [createNotes, addPinned] });
  await migrate(db, { notes: [createNotes, addPinned] });

  expect(await db`SELECT id, body, pinned FROM notes`).toEqual([
    { id: "n1", body: "hello", pinned: 0 },
  ]);
});

test("a database from before versions were recorded upgrades in place", async () => {
  const db = openDatabase();
  await db.unsafe(createNotes);
  await db`INSERT INTO notes (id, body) VALUES ('n1', 'hello')`;

  await migrate(db, { notes: [createNotes, addPinned] });

  expect(await db`SELECT id, body, pinned FROM notes`).toEqual([
    { id: "n1", body: "hello", pinned: 0 },
  ]);
});

test("a failed version leaves the database as it was", async () => {
  const db = openDatabase();
  await migrate(db, { notes: [createNotes] });

  const broken = { notes: [createNotes, addPinned, `ALTER TABLE missing ADD COLUMN title TEXT`] };
  await expect(migrate(db, broken)).rejects.toThrow("no such table: missing");

  expect(await columns(db)).toEqual(["id", "body"]);
});

test("an older Toy Box leaves a newer database's versions in place", async () => {
  const db = openDatabase();
  await migrate(db, { notes: [createNotes, addPinned] });

  await migrate(db, { notes: [createNotes] });
  await migrate(db, { notes: [createNotes, addPinned] });

  expect(await columns(db)).toEqual(["id", "body", "pinned"]);
});
