// Narrow parser for the small subset of SQL Copilot currently emits for the
// `todos` table. It translates supported statements into TodoItemPatch[]
// and leaves tool-call policy to the projector.

import type { TodoItemPatch, TodoStatus } from "@/types";

/** Return todo patches when SQL touches the todo tables; undefined means the
 *  statement is unrelated. An empty array intentionally hides read-only or
 *  dependency-only todo SQL without inventing state changes. */
export function parseTodoSql(query: string): TodoItemPatch[] | undefined {
  let touchesTodos = false;
  const patches: TodoItemPatch[] = [];

  for (const statement of splitTopLevel(query, ";")) {
    const parsedStatement = parseTodoStatement(statement);
    if (!parsedStatement) continue;

    touchesTodos = true;
    patches.push(...parsedStatement);
  }

  return touchesTodos ? patches : undefined;
}

function parseTodoStatement(statement: string): TodoItemPatch[] | undefined {
  const trimmed = statement.trim();
  if (!trimmed) return undefined;

  return (
    parseTodoInsert(trimmed) ??
    parseTodoUpdate(trimmed) ??
    parseTodoDelete(trimmed) ??
    parseTodoSelect(trimmed) ??
    parseTodoFallback(trimmed)
  );
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
    const rowInput = row.trim();
    const tuple = readParenthesized(rowInput);
    if (!tuple) continue;

    const suffix = rowInput.slice(tuple.end).trimStart();
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

  const rest = statement.slice(match[0].length).trimStart();
  const whereIndex = findTopLevelKeyword(rest, "where");
  const assignments = (whereIndex === -1 ? rest : rest.slice(0, whereIndex)).trim();
  const parsedUpdate = parseTodoAssignments(assignments);

  if (whereIndex === -1) {
    return parsedUpdate.status !== undefined
      ? [{ type: "update_all", status: parsedUpdate.status }]
      : [];
  }

  const whereClause = rest.slice(whereIndex + "where".length).trim();
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

  const rest = statement.slice(match[0].length).trimStart();
  const whereIndex = findTopLevelKeyword(rest, "where");
  if (whereIndex === -1) return [];

  const ids = parseTodoIdsWhereClause(rest.slice(whereIndex + "where".length).trim());
  return ids.map((id) => ({ type: "delete", id }));
}

function parseTodoSelect(statement: string): TodoItemPatch[] | undefined {
  return /\bselect\b[\s\S]*\bfrom\s+todos\b/i.test(statement) ? [] : undefined;
}

function parseTodoFallback(statement: string): TodoItemPatch[] | undefined {
  return /\b(?:into|from|update)\s+todo(?:s|_deps)\b/i.test(statement) ? [] : undefined;
}

function parseTodoAssignments(assignments: string) {
  let title: string | undefined;
  let status: TodoStatus | undefined;

  for (const assignment of splitTopLevel(assignments, ",")) {
    const equalsIndex = findTopLevelChar(assignment, "=");
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
  const equalsIndex = findTopLevelChar(input, "=");
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

  let depth = 0;
  let inString = false;
  for (let i = 0; i < input.length; i++) {
    const quote = consumeSqlQuote(input, i, inString);
    if (quote) {
      i = quote.nextIndex;
      inString = quote.inString;
      continue;
    }

    const char = input[i];
    if (inString) continue;
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return { value: input.slice(1, i), end: i + 1 };
      }
    }
  }

  return undefined;
}

function splitTopLevel(input: string, delimiter: ";" | ","): string[] {
  const parts: string[] = [];
  let inString = false;
  let depth = 0;
  let start = 0;

  for (let i = 0; i < input.length; i++) {
    const quote = consumeSqlQuote(input, i, inString);
    if (quote) {
      i = quote.nextIndex;
      inString = quote.inString;
      continue;
    }

    const char = input[i];
    if (inString) continue;
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && char === delimiter) {
      const part = input.slice(start, i).trim();
      if (part) parts.push(part);
      start = i + 1;
    }
  }

  const tail = input.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function findTopLevelChar(input: string, target: string): number {
  let inString = false;
  let depth = 0;

  for (let i = 0; i < input.length; i++) {
    const quote = consumeSqlQuote(input, i, inString);
    if (quote) {
      i = quote.nextIndex;
      inString = quote.inString;
      continue;
    }

    const char = input[i];
    if (inString) continue;
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && char === target) return i;
  }

  return -1;
}

function findTopLevelKeyword(input: string, keyword: string): number {
  const lowerInput = input.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  let inString = false;
  let depth = 0;

  for (let i = 0; i <= input.length - lowerKeyword.length; i++) {
    const quote = consumeSqlQuote(input, i, inString);
    if (quote) {
      i = quote.nextIndex;
      inString = quote.inString;
      continue;
    }

    const char = input[i];
    if (inString) continue;
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth !== 0 || !lowerInput.startsWith(lowerKeyword, i)) continue;

    const before = input[i - 1];
    const after = input[i + lowerKeyword.length];
    const beforeIsBoundary = before === undefined || /\s/.test(before);
    const afterIsBoundary = after === undefined || /\s/.test(after);
    if (beforeIsBoundary && afterIsBoundary) return i;
  }

  return -1;
}

function consumeSqlQuote(
  input: string,
  index: number,
  inString: boolean,
): { nextIndex: number; inString: boolean } | undefined {
  if (input[index] !== "'") return undefined;

  if (inString && input[index + 1] === "'") {
    return { nextIndex: index + 1, inString };
  }

  if (inString && isBackslashEscaped(input, index)) {
    return { nextIndex: index, inString };
  }

  return { nextIndex: index, inString: !inString };
}

function isBackslashEscaped(input: string, index: number): boolean {
  let slashCount = 0;
  for (let i = index - 1; i >= 0 && input[i] === "\\"; i--) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}
