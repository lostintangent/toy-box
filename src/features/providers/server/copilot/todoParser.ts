// Narrow parser for the small subset of SQL Copilot currently emits for the
// `todos` table. It translates supported statements into TodoItemPatch[]
// and leaves tool-call policy to the projector.

import type { TodoItemPatch, TodoStatus } from "@sessions/model";

/** Return todo patches when SQL touches the todo tables; undefined means the
 *  statement is unrelated. An empty array intentionally hides read-only or
 *  dependency-only todo SQL without inventing state changes. */
export function parseTodoSql(query: string): TodoItemPatch[] | undefined {
  const statements = splitTopLevel(query, ";").flatMap((statement) => {
    const patches =
      parseTodoInsert(statement) ??
      parseTodoUpdate(statement) ??
      parseTodoDelete(statement) ??
      parseTodoFallback(statement);
    return patches ? [patches] : [];
  });
  return statements.length > 0 ? statements.flat() : undefined;
}

function parseTodoInsert(statement: string): TodoItemPatch[] | undefined {
  const match = statement.match(/^insert\s+(?:or\s+(?:ignore|replace)\s+)?into\s+todos\b/i);
  if (!match) return undefined;

  const rest = statement.slice(match[0].length).trimStart();
  const columns = readParenthesized(rest);
  if (!columns) return [];

  const valuesInput = rest.slice(columns.end).trimStart();
  if (!valuesInput.match(/^values\b/i)) return [];

  const columnNames = splitTopLevel(columns.value, ",")
    .map(normalizeIdentifier)
    .filter((value): value is string => value !== undefined);
  if (columnNames.length === 0) return [];

  const patches: TodoItemPatch[] = [];
  const rows = splitTopLevel(valuesInput.slice("values".length).trimStart(), ",");
  for (const row of rows) {
    const tuple = readParenthesized(row);
    if (!tuple) continue;

    const suffix = row.slice(tuple.end).trimStart();
    if (suffix && !/^on\s+conflict\b/i.test(suffix)) continue;

    const values = splitTopLevel(tuple.value, ",");
    if (values.length !== columnNames.length) continue;

    const record = new Map<string, string>();
    for (let i = 0; i < columnNames.length; i++) {
      const value = parseSqlValue(values[i]);
      if (value !== undefined) record.set(columnNames[i], value);
    }

    const id = record.get("id");
    const title = record.get("title");
    if (!id || !title) continue;

    patches.push({
      type: "upsert",
      id,
      title,
      status: parseTodoStatus(record.get("status")) ?? "pending",
    });
  }

  return patches;
}

function parseTodoUpdate(statement: string): TodoItemPatch[] | undefined {
  const match = statement.match(/^update\s+todos\s+set\b/i);
  if (!match) return undefined;

  const [assignments, whereClause] = splitAtWhere(statement.slice(match[0].length));
  const parsedUpdate = parseTodoAssignments(assignments);

  if (whereClause === undefined) {
    return parsedUpdate.status !== undefined
      ? [{ type: "update_all", status: parsedUpdate.status }]
      : [];
  }

  const ids = parseTodoIdsWhereClause(whereClause);
  if (ids.length === 0) return [];

  if (parsedUpdate.title === undefined && parsedUpdate.status === undefined) {
    return [];
  }

  return ids.map((id) => ({
    type: "upsert",
    id,
    title: parsedUpdate.title,
    status: parsedUpdate.status,
  }));
}

function parseTodoDelete(statement: string): TodoItemPatch[] | undefined {
  const match = statement.match(/^delete\s+from\s+todos\b/i);
  if (!match) return undefined;

  const [, whereClause] = splitAtWhere(statement.slice(match[0].length));
  if (whereClause === undefined) return [];

  const ids = parseTodoIdsWhereClause(whereClause);
  return ids.map((id) => ({ type: "delete", id }));
}

function parseTodoFallback(statement: string): TodoItemPatch[] | undefined {
  return /\b(?:into|from|update)\s+todo(?:s|_deps)\b/i.test(statement) ? [] : undefined;
}

function parseTodoAssignments(assignments: string) {
  let title: string | undefined;
  let status: TodoStatus | undefined;

  for (const assignment of splitTopLevel(assignments, ",")) {
    const equalsIndex = findTopLevel(assignment, "=");
    if (equalsIndex === -1) continue;

    const column = normalizeIdentifier(assignment.slice(0, equalsIndex));
    const value = parseSqlValue(assignment.slice(equalsIndex + 1));
    if (!column || value === undefined) continue;

    if (column === "title") {
      title = value;
      continue;
    }

    if (column === "status") {
      const nextStatus = parseTodoStatus(value);
      if (nextStatus) status = nextStatus;
    }
  }

  return { title, status };
}

function parseTodoIdComparison(input: string): string | undefined {
  const equalsIndex = findTopLevel(input, "=");
  if (equalsIndex === -1) return undefined;

  const left = normalizeIdentifier(input.slice(0, equalsIndex));
  const right = normalizeIdentifier(input.slice(equalsIndex + 1));
  const leftValue = parseSqlValue(input.slice(0, equalsIndex));
  const rightValue = parseSqlValue(input.slice(equalsIndex + 1));

  if (left === "id" && rightValue !== undefined) return rightValue;
  if (right === "id" && leftValue !== undefined) return leftValue;
  return undefined;
}

function parseTodoIdsWhereClause(input: string): string[] {
  const comparisonId = parseTodoIdComparison(input);
  if (comparisonId) return [comparisonId];

  return parseTodoIdInComparison(input) ?? [];
}

function parseTodoIdInComparison(input: string): string[] | undefined {
  const match = input.match(
    /^\s*((?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[a-z_][a-z0-9_]*)(?:\.(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[a-z_][a-z0-9_]*))?)\s+in\b/i,
  );
  if (!match || normalizeIdentifier(match[1]) !== "id") return undefined;

  const rest = input.slice(match[0].length).trimStart();
  const values = readParenthesized(rest);
  if (!values || rest.slice(values.end).trim()) return undefined;

  const ids: string[] = [];
  for (const value of splitTopLevel(values.value, ",")) {
    const id = parseSqlValue(value);
    if (id === undefined) return undefined;
    ids.push(id);
  }

  return ids.length > 0 ? ids : undefined;
}

function parseSqlValue(input: string): string | undefined {
  const trimmed = input.trim();
  if (!trimmed || /^null$/i.test(trimmed)) return undefined;
  if (/^'(?:\\'|''|[^'])*'$/.test(trimmed)) {
    return trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/''/g, "'");
  }
  if (/^[a-z_][a-z0-9_]*$/i.test(trimmed)) {
    return trimmed;
  }
  return undefined;
}

function parseTodoStatus(value: string | undefined): TodoStatus | undefined {
  if (value === "pending" || value === "in_progress" || value === "done" || value === "blocked") {
    return value;
  }
  return undefined;
}

function normalizeIdentifier(input: string): string | undefined {
  let value = input.trim();
  if (!value) return undefined;

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("`") && value.endsWith("`")) ||
    (value.startsWith("[") && value.endsWith("]"))
  ) {
    value = value.slice(1, -1);
  }

  const parts = value.split(".");
  return parts[parts.length - 1]?.trim().toLowerCase() || undefined;
}

function readParenthesized(input: string): { value: string; end: number } | undefined {
  if (!input.startsWith("(")) return undefined;
  const end = findTopLevel(input, ")");
  return end === -1 ? undefined : { value: input.slice(1, end), end: end + 1 };
}

function splitTopLevel(input: string, delimiter: ";" | ","): string[] {
  const parts: string[] = [];
  let start = 0;
  for (const i of topLevelIndices(input)) {
    if (input[i] !== delimiter) continue;
    parts.push(input.slice(start, i));
    start = i + 1;
  }
  parts.push(input.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

/** Split a statement tail at its top-level WHERE keyword. */
function splitAtWhere(input: string): [head: string, where?: string] {
  for (const i of topLevelIndices(input)) {
    if ((i === 0 || /\s/.test(input[i - 1])) && /^where(?:\s|$)/i.test(input.slice(i, i + 6))) {
      return [input.slice(0, i).trim(), input.slice(i + "where".length).trim()];
    }
  }
  return [input.trim()];
}

function findTopLevel(input: string, char: string): number {
  for (const i of topLevelIndices(input)) {
    if (input[i] === char) return i;
  }
  return -1;
}

/** Yield indices outside SQL strings and nested parentheses. A top-level
 *  group's own parentheses are yielded, so callers can find where it ends. */
function* topLevelIndices(input: string): Generator<number> {
  let inString = false;
  let depth = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (char === "'") {
      if (inString && input[i + 1] === "'") i += 1;
      else if (!inString || !isBackslashEscaped(input, i)) inString = !inString;
      continue;
    }
    if (inString) continue;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (depth === 0) yield i;
    if (char === "(") depth += 1;
  }
}

function isBackslashEscaped(input: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && input[i] === "\\"; i--) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
