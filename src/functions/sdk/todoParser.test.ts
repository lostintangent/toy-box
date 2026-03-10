import { describe, expect, test } from "bun:test";
import { parseTodoSql } from "./todoParser";

describe("todo parser", () => {
  test("parses multi-row todo inserts into ordered todo patches", () => {
    expect(
      parseTodoSql(
        "INSERT INTO todos (id, title) VALUES " +
          "('inspect-sql-events', 'inspect SQL events'), " +
          "('verify-todo-ui', 'verify todo UI');",
      ),
    ).toEqual({
      patches: [
        {
          type: "upsert",
          id: "inspect-sql-events",
          title: "inspect SQL events",
          status: "pending",
        },
        {
          type: "upsert",
          id: "verify-todo-ui",
          title: "verify todo UI",
          status: "pending",
        },
      ],
    });
  });

  test("parses todo inserts with upsert clauses and escaped quotes", () => {
    expect(
      parseTodoSql(
        "INSERT INTO todos (id, title, description, status) VALUES " +
          "('seinen-weekly-releases', 'Find weekly seinen releases', " +
          "'Retrieve this week\\'s seinen manga releases and match against shared reading preferences.', " +
          "'in_progress') ON CONFLICT(id) DO UPDATE SET status='in_progress', updated_at=CURRENT_TIMESTAMP;",
      ),
    ).toEqual({
      patches: [
        {
          type: "upsert",
          id: "seinen-weekly-releases",
          title: "Find weekly seinen releases",
          status: "in_progress",
        },
      ],
    });
  });

  test("parses todo updates for status and title changes", () => {
    expect(
      parseTodoSql(
        "UPDATE todos SET status = 'done', title = 'inspect SQL events' WHERE id = 'inspect-sql-events';",
      ),
    ).toEqual({
      patches: [
        {
          type: "upsert",
          id: "inspect-sql-events",
          title: "inspect SQL events",
          status: "done",
        },
      ],
    });
  });

  test("parses todo updates that change the status of every todo", () => {
    expect(parseTodoSql("UPDATE todos SET status = 'done';")).toEqual({
      patches: [{ type: "update_all", status: "done" }],
    });
  });

  test("hides todo selects without emitting todo state changes", () => {
    expect(parseTodoSql("SELECT id, title, status FROM todos;")).toEqual({
      patches: [],
    });
  });

  test("parses todo deletes into delete patches", () => {
    expect(parseTodoSql("DELETE FROM todos WHERE id = 'inspect-sql-events';")).toEqual({
      patches: [{ type: "delete", id: "inspect-sql-events" }],
    });
  });

  test("parses INSERT OR IGNORE INTO todos into upsert patches", () => {
    expect(
      parseTodoSql(
        "INSERT OR IGNORE INTO todos (id, title, description, status) VALUES " +
          "('parse-reading-list', 'Parse reading list', 'Load current reading-list gist.', 'in_progress'), " +
          "('generate-candidates', 'Generate candidate first vols', 'Find strong first-volume candidates.', 'pending');",
      ),
    ).toEqual({
      patches: [
        {
          type: "upsert",
          id: "parse-reading-list",
          title: "Parse reading list",
          status: "in_progress",
        },
        {
          type: "upsert",
          id: "generate-candidates",
          title: "Generate candidate first vols",
          status: "pending",
        },
      ],
    });
  });

  test("parses INSERT OR REPLACE INTO todos into upsert patches", () => {
    expect(
      parseTodoSql(
        "INSERT OR REPLACE INTO todos (id, title, status) VALUES ('my-todo', 'My todo', 'done');",
      ),
    ).toEqual({
      patches: [{ type: "upsert", id: "my-todo", title: "My todo", status: "done" }],
    });
  });

  test("hides todo_deps inserts without emitting patches", () => {
    expect(
      parseTodoSql(
        "INSERT OR IGNORE INTO todo_deps (todo_id, depends_on) VALUES " +
          "('generate-candidates', 'parse-reading-list'), " +
          "('rank-quick-picks', 'generate-candidates');",
      ),
    ).toEqual({ patches: [] });
  });

  test("ignores sql that does not touch the todos table", () => {
    expect(parseTodoSql("SELECT * FROM session_messages;")).toBeUndefined();
  });
});
