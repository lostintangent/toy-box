// The domain of the codebase as its nouns, verbs, and contracts.
//
//   bun run domain diff [base]      what the working tree changes against a git ref (default HEAD)
//                                   or another copy of the tree, such as the shared one
//   bun run domain map [area…]      the nouns and verbs of some or all subsystems
//   bun run domain map --json       the same model as JSON, to query
//
// Nouns are exported types, interfaces, classes, and enums. A schema isn't one: the type inferred
// from it is, with the schema's shape. Verbs are exported functions, hooks, components, and public
// class methods. Contracts are the surfaces other processes depend on: agent tools, server
// functions, workspace events and panes, HTTP routes, sockets, and table schemas.

import { $ } from "bun";
import { mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import ts from "app-typescript";

/** A noun's members map each property to its type, so a changed property type shows up too. */
type Noun = {
  name: string;
  kind: string;
  file: string;
  members: Record<string, string>;
  text: string;
};
type Verb = { name: string; kind: string; file: string; signature: string; uses: string[] };
type Tool = { params: string[]; flags: string[]; description: string };
type Contracts = {
  tools: Record<string, Tool>;
  /** Server functions, the RPC surface clients call, to their input's fields. */
  rpc: Record<string, string[]>;
  events: string[];
  panes: string[];
  routes: string[];
  sockets: string[];
  schemas: Record<string, number>;
};
export type DomainModel = {
  nouns: Record<string, Noun>;
  verbs: Record<string, Verb>;
  contracts: Contracts;
  /** Each exported entity's ID to the files that use it, its own and tests included. */
  importers: Record<string, string[]>;
};

const SOURCE = /^(src|evals)\/.*\.tsx?$/;
const SKIP = /(\.test\.|testFixtures|\/codex\/protocol\/|\.d\.ts$|routeTree\.gen)/;
const byText = (a: string, b: string) => a.localeCompare(b);
const isDirectory = async (path: string) =>
  (await stat(path).catch(() => null))?.isDirectory() ?? false;
const isTest = (file: string) => /\.test\.|^tests\/|testFixtures/.test(file);

export function subsystem(file: string): string {
  const feature = file.match(/^src\/features\/([^/]+)/);
  if (feature) return feature[1]!;
  const top = file.match(/^src\/([^/]+)/);
  return top ? top[1]! : file.split("/")[0]!;
}

// ── Reading a model ────────────────────────────────────────────────────

export function readModel(root: string): DomainModel {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(root, "tsconfig.json"),
    {},
    { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} },
  )!;
  const rel = (file: string) => relative(root, file);
  const files = config.fileNames.filter((file) => /^(src|evals|tests)\//.test(rel(file)));
  const roots = files.filter((file) => SOURCE.test(rel(file)) && !SKIP.test(rel(file)));
  const rootSet = new Set(roots);
  const program = ts.createProgram(files, config.options);
  const checker = program.getTypeChecker();
  const model: DomainModel = {
    nouns: {},
    verbs: {},
    contracts: { tools: {}, rpc: {}, events: [], panes: [], routes: [], sockets: [], schemas: {} },
    importers: {},
  };

  const idOf = (symbol: ts.Symbol): string | undefined => {
    const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
    const file = target.declarations?.[0]?.getSourceFile().fileName;
    return file && rootSet.has(file) ? `${rel(file)}#${target.name}` : undefined;
  };

  /** The root-declared nouns a type mentions, through unions, type arguments, and arrays. */
  const nounsIn = (type: ts.Type, into: Set<string>, depth = 0) => {
    if (depth > 3) return;
    for (const symbol of [type.aliasSymbol, type.getSymbol()]) {
      const id = symbol && idOf(symbol);
      if (id) into.add(id);
    }
    const nested = [
      ...(type.aliasTypeArguments ?? []),
      ...(type.isUnionOrIntersection() ? type.types : []),
      ...(type.flags & ts.TypeFlags.Object
        ? checker.getTypeArguments(type as ts.TypeReference)
        : []),
    ];
    for (const inner of nested) nounsIn(inner, into, depth + 1);
  };

  /**
   * A noun's members by name, resolved through aliases, intersections, unions, and arrays. Each
   * member keeps the text of its own declaration when the noun declares it, so a change shows up
   * where it's made rather than in every noun that embeds it.
   */
  const membersOf = (type: ts.Type, owner: ts.Node): Record<string, string> => {
    const members: Record<string, string> = {};
    const own = (node: ts.Node | undefined) =>
      !!node &&
      node.getSourceFile() === owner.getSourceFile() &&
      node.pos >= owner.pos &&
      node.end <= owner.end;
    const seen = new Set<ts.Type>();
    const collect = (part: ts.Type) => {
      if (seen.has(part)) return;
      seen.add(part);
      if (checker.isArrayType(part))
        collect(checker.getTypeArguments(part as ts.TypeReference)[0]!);
      else if (part.isUnionOrIntersection()) part.types.forEach(collect);
      else if (part.flags & ts.TypeFlags.Object) {
        for (const property of checker.getPropertiesOfType(part)) {
          const declaration = property.declarations?.[0];
          const hidden =
            !declaration ||
            !rootSet.has(declaration.getSourceFile().fileName) ||
            ts.isMethodDeclaration(declaration) ||
            ts.getCombinedModifierFlags(declaration) &
              (ts.ModifierFlags.Private | ts.ModifierFlags.Protected);
          if (/^(__|#)/.test(property.name) || hidden) continue;
          const text = own(declaration) ? flat(declaration!.getText()) : "";
          addMember(members, property.name, text);
        }
      }
    };
    collect(type);
    return Object.fromEntries(Object.entries(members).sort(([a], [b]) => a.localeCompare(b)));
  };

  const verbOf = (
    name: string,
    file: string,
    declaration: ts.SignatureDeclaration,
    symbol: ts.Symbol,
  ): Verb => {
    const uses = new Set<string>();
    const call = checker.getSignaturesOfType(
      checker.getTypeOfSymbol(symbol),
      ts.SignatureKind.Call,
    )[0];
    if (call) {
      for (const parameter of call.parameters) nounsIn(checker.getTypeOfSymbol(parameter), uses);
      if (!file.endsWith(".tsx")) nounsIn(call.getReturnType(), uses);
    }
    const kind = /^use[A-Z]/.test(name)
      ? "hook"
      : /^[A-Z]/.test(name) && file.endsWith(".tsx")
        ? "component"
        : "function";
    return {
      name,
      kind,
      file,
      signature: compactSignature(declaration),
      uses: [...uses].sort(byText),
    };
  };

  // A schema isn't a noun. It defines one, the type inferred from it, which takes its shape.
  const schemas = new Map<string, Noun>();
  const inferredFrom = new Map<string, string>();
  for (const source of program.getSourceFiles()) {
    if (!rootSet.has(source.fileName)) continue;
    const file = rel(source.fileName);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    for (const exported of moduleSymbol ? checker.getExportsOfModule(moduleSymbol) : []) {
      // `export { a, b }` lists alias symbols declared in this same file.
      const symbol =
        exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const declaration = symbol.declarations?.[0];
      if (!declaration || declaration.getSourceFile() !== source) continue;
      // A default export is a convention contribution, which its file's name already says.
      if (exported.name === "default") continue;
      const id = `${file}#${symbol.name}`;
      if (ts.isFunctionDeclaration(declaration)) {
        model.verbs[id] = verbOf(symbol.name, file, declaration, symbol);
      } else if (ts.isVariableDeclaration(declaration)) {
        const init = declaration.initializer;
        const fn = init;
        // A server function is a contract: createServerFn(…).handler(({ data }) => …).
        const handler =
          init && ts.isCallExpression(init) && /^createServerFn\b/.test(init.getText(source))
            ? init.arguments[0]
            : undefined;
        if (handler && (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler))) {
          const input = handler.parameters[0];
          const data = input && checker.getTypeAtLocation(input).getProperty("data");
          const fields = data ? checker.getTypeOfSymbolAtLocation(data, input!) : undefined;
          const names = !fields
            ? []
            : fields.flags & ts.TypeFlags.Object
              ? checker.getPropertiesOfType(fields).map((p) => p.name)
              : [checker.typeToString(fields)];
          model.contracts.rpc[`${subsystem(file)}.${symbol.name}`] = names.sort(byText);
          continue;
        }
        // A schema is a value that parses to a type, and its members are that type's.
        const parsed = init && checker.getTypeOfSymbol(symbol).getProperty("_output");
        if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) {
          model.verbs[id] = verbOf(symbol.name, file, fn, symbol);
        } else if (parsed) {
          const members = membersOf(checker.getTypeOfSymbol(parsed), declaration);
          const text = Object.keys(members).length ? "" : flat(init!.getText(source));
          schemas.set(id, { name: symbol.name, kind: "type", file, members, text });
        }
      } else if (
        ts.isTypeAliasDeclaration(declaration) ||
        ts.isInterfaceDeclaration(declaration) ||
        ts.isEnumDeclaration(declaration) ||
        ts.isClassDeclaration(declaration)
      ) {
        const type = checker.getDeclaredTypeOfSymbol(symbol);
        const members = membersOf(type, declaration);
        const inferred =
          ts.isTypeAliasDeclaration(declaration) &&
          declaration.type.getText(source).match(/^z\.(?:infer|input|output)<typeof (\w+)>$/)?.[1];
        if (inferred) inferredFrom.set(id, `${file}#${inferred}`);
        const text =
          ts.isTypeAliasDeclaration(declaration) && !Object.keys(members).length
            ? flat(declaration.type.getText(source))
            : "";
        const implemented = ts.isClassDeclaration(declaration)
          ? declaration.heritageClauses?.find((c) => c.token === ts.SyntaxKind.ImplementsKeyword)
          : undefined;
        const kind = implemented
          ? `class implementing ${implemented.types.map((t) => t.getText(source)).join(", ")}`
          : nounKind(declaration);
        model.nouns[id] = { name: symbol.name, kind, file, members, text };
        // A class implementing an interface is reached through it, so its methods are the
        // interface's verbs rather than its own.
        if (ts.isClassDeclaration(declaration) && !implemented) {
          for (const member of declaration.members) {
            const hidden =
              ts.getCombinedModifierFlags(member) &
              (ts.ModifierFlags.Private | ts.ModifierFlags.Protected);
            if (!ts.isMethodDeclaration(member) || hidden || !ts.isIdentifier(member.name))
              continue;
            const method = checker.getSymbolAtLocation(member.name);
            const name = `${symbol.name}.${member.name.text}`;
            if (method)
              model.verbs[`${id}.${member.name.text}`] = verbOf(name, file, member, method);
          }
        }
      }
    }
    readContracts(source, file, model.contracts, checker);
  }
  for (const [typeId, schemaId] of inferredFrom) {
    const schema = schemas.get(schemaId);
    if (schema) model.nouns[typeId] = { ...schema, name: model.nouns[typeId]!.name };
  }
  const modelled = roots.map(rel);
  model.contracts.routes = modelled
    .filter((file) => /^src\/features\/[^/]+\/routes\//.test(file))
    .sort(byText);
  model.contracts.sockets = modelled
    .filter((file) => file.endsWith("server/websocket.ts"))
    .sort(byText);
  // A function named after a noun, like `channelLead` for `ChannelLead`, builds it: it's the
  // noun's constructor, not a verb of its own.
  const nounNames = new Set(Object.values(model.nouns).map((noun) => noun.name));
  for (const verb of Object.values(model.verbs)) {
    verb.uses = verb.uses.filter((id) => id in model.nouns);
    const noun = verb.name[0]!.toUpperCase() + verb.name.slice(1);
    if (verb.kind === "function" && nounNames.has(noun)) verb.kind = `constructor of ${noun}`;
  }

  // Every file that names an entity, through whichever import shape, resolved by the checker.
  const schemaTypes = new Map([...inferredFrom].map(([type, schema]) => [schema, type]));
  const importers: Record<string, Set<string>> = {};
  for (const name of files) {
    const file = rel(name);
    const visit = (node: ts.Node) => {
      // A shorthand `const { a } = await import("…")` binds a local, so read `a` off the module.
      const symbol =
        ts.isBindingElement(node) && !node.propertyName && ts.isIdentifier(node.name)
          ? checker.getPropertyOfType(checker.getTypeAtLocation(node.parent), node.name.text)
          : ts.isIdentifier(node)
            ? checker.getSymbolAtLocation(node)
            : undefined;
      const declared = symbol && idOf(symbol);
      const id = (declared && schemaTypes.get(declared)) ?? declared;
      const declares = isDeclarationName(node);
      if (id && !declares) (importers[id] ??= new Set()).add(file);
      ts.forEachChild(node, visit);
    };
    visit(program.getSourceFile(name)!);
  }
  for (const [id, users] of Object.entries(importers)) {
    if (id in model.nouns || id in model.verbs) model.importers[id] = [...users].sort(byText);
  }
  return model;
}

/** Whether a node names the entity it declares, which isn't a use of it. */
function isDeclarationName(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    !!parent &&
    (ts.isFunctionDeclaration(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isMethodDeclaration(parent)) &&
    parent.name === node
  );
}

function nounKind(declaration: ts.Declaration): string {
  if (ts.isTypeAliasDeclaration(declaration)) return "type";
  if (ts.isInterfaceDeclaration(declaration)) return "interface";
  return ts.isEnumDeclaration(declaration) ? "enum" : "class";
}

function compactSignature(declaration: ts.SignatureDeclaration): string {
  const binding = (name: ts.BindingName): string =>
    ts.isIdentifier(name)
      ? name.text
      : ts.isObjectBindingPattern(name)
        ? `{ ${name.elements.map((element) => element.propertyName?.getText() ?? binding(element.name)).join(", ")} }`
        : `[${name.elements.map((element) => (ts.isOmittedExpression(element) ? "" : binding(element.name))).join(", ")}]`;
  const parameters = declaration.parameters.map(
    (p) =>
      `${p.dotDotDotToken ? "..." : ""}${binding(p.name)}${p.questionToken || p.initializer ? "?" : ""}`,
  );
  return `(${parameters.join(", ")})`;
}

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

/** Each union variant that declares a member adds its text, so a new variant shows up. */
function addMember(members: Record<string, string>, name: string, text: string) {
  if (!members[name]?.includes(text)) {
    members[name] = [members[name], text].filter(Boolean).join(" | ");
  }
}

function readContracts(
  source: ts.SourceFile,
  file: string,
  contracts: Contracts,
  checker: ts.TypeChecker,
) {
  if (file.endsWith("server/schema.ts")) {
    for (const statement of source.statements) {
      if (ts.isExportAssignment(statement) && ts.isArrayLiteralExpression(statement.expression)) {
        contracts.schemas[subsystem(file)] = statement.expression.elements.length;
      }
    }
  }
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const [first, second] = node.arguments;
      const isTool = ts.isIdentifier(node.expression) && node.expression.text === "defineTool";
      if (
        isTool &&
        first &&
        ts.isStringLiteral(first) &&
        second &&
        ts.isObjectLiteralExpression(second)
      ) {
        const tool: Tool = { params: [], flags: [], description: "" };
        for (const property of second.properties) {
          if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
          const value = property.initializer;
          if (property.name.text === "description") {
            tool.description = flat(value.getText(source));
          } else if (property.name.text === "parameters") {
            const parsed = checker.getTypeAtLocation(value).getProperty("_output");
            const shape = parsed && checker.getTypeOfSymbol(parsed);
            tool.params = shape ? checker.getPropertiesOfType(shape).map((p) => p.name) : [];
          } else if (value.kind === ts.SyntaxKind.TrueKeyword) {
            tool.flags.push(property.name.text);
          }
        }
        contracts.tools[first.text] = tool;
      }
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === "WorkspacePanes") {
      for (const member of node.members) {
        if (member.name) contracts.panes.push(member.name.getText(source));
      }
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === "WorkspaceEvents") {
      const collect = (child: ts.Node) => {
        if (
          ts.isPropertySignature(child) &&
          child.name.getText(source) === "type" &&
          child.type &&
          ts.isLiteralTypeNode(child.type) &&
          ts.isStringLiteral(child.type.literal)
        ) {
          contracts.events.push(child.type.literal.text);
        }
        ts.forEachChild(child, collect);
      };
      collect(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

// ── Diff ───────────────────────────────────────────────────────────────

/**
 * How far an export reaches beyond its own file, when only tests or nothing use it there: a
 * production export says nothing, one only tests reach was exported for them, and one nothing
 * reaches needn't be exported.
 */
export function reachNote(model: DomainModel, id: string, file: string): string {
  // A method is reached through its class.
  const owner = id.slice(id.indexOf("#")).includes(".") ? id.slice(0, id.lastIndexOf(".")) : id;
  const users = (model.importers[owner] ?? []).filter((user) => user !== file);
  if (users.some((user) => !isTest(user))) return "";
  return users.length ? " (exported only for tests)" : " (nothing outside its file uses it)";
}

const words = (name: string) => name.split(/(?=[A-Z])|\./).map((word) => word.toLowerCase());
const sharedWords = (a: string, b: string) =>
  words(a).filter((word) => words(b).includes(word)).length;

/**
 * Each subsystem's contract with the others: the exports another subsystem's production code
 * uses, to the subsystems that use them. Like server functions between server and client, the
 * contract is a boundary to keep semantic; everything else a subsystem exports is internal.
 */
export function subsystemContracts(model: DomainModel): Map<string, Map<string, Set<string>>> {
  const contracts = new Map<string, Map<string, Set<string>>>();
  for (const [id, files] of Object.entries(model.importers)) {
    const entity = model.nouns[id] ?? model.verbs[id]!;
    const owner = subsystem(entity.file);
    for (const file of files) {
      const consumer = subsystem(file);
      if (consumer === owner || isTest(file)) continue;
      const contract = contracts.get(owner) ?? new Map<string, Set<string>>();
      contracts.set(
        owner,
        contract.set(entity.name, (contract.get(entity.name) ?? new Set()).add(consumer)),
      );
    }
  }
  return contracts;
}

type Change = { subsystem: string; line: string };
type Entity = Noun | Verb;

export function diffModels(before: DomainModel, after: DomainModel) {
  const contracts: string[] = [];
  const listDiff = (label: string, was: string[], now: string[]) => {
    for (const value of now)
      if (!was.includes(value)) contracts.push(`- ${label}: added \`${value}\``);
    for (const value of was)
      if (!now.includes(value)) contracts.push(`- ${label}: removed \`${value}\``);
  };
  const tools = [
    ...new Set([...Object.keys(before.contracts.tools), ...Object.keys(after.contracts.tools)]),
  ];
  for (const name of tools.sort(byText)) {
    const was = before.contracts.tools[name];
    const now = after.contracts.tools[name];
    if (!was) contracts.push(`- Agent tool: added \`${name}\`(${now!.params.join(", ")})`);
    else if (!now) contracts.push(`- Agent tool: removed \`${name}\``);
    else {
      const notes = [
        ...now.params.filter((p) => !was.params.includes(p)).map((p) => `+${p}`),
        ...was.params.filter((p) => !now.params.includes(p)).map((p) => `−${p}`),
        ...now.flags.filter((f) => !was.flags.includes(f)).map((f) => `now ${f}`),
        ...was.flags.filter((f) => !now.flags.includes(f)).map((f) => `no longer ${f}`),
        ...(was.description === now.description ? [] : ["description changed"]),
      ];
      if (notes.length) contracts.push(`- Agent tool: changed \`${name}\`: ${notes.join(", ")}`);
    }
  }
  for (const name of new Set([
    ...Object.keys(before.contracts.rpc),
    ...Object.keys(after.contracts.rpc),
  ])) {
    const was = before.contracts.rpc[name];
    const now = after.contracts.rpc[name];
    if (!was) contracts.push(`- Server function: added \`${name}\`(${now!.join(", ")})`);
    else if (!now) contracts.push(`- Server function: removed \`${name}\``);
    else if (was.join() !== now.join()) {
      const notes = [
        ...now.filter((f) => !was.includes(f)).map((f) => `+${f}`),
        ...was.filter((f) => !now.includes(f)).map((f) => `−${f}`),
      ];
      contracts.push(`- Server function: changed \`${name}\`: ${notes.join(", ")}`);
    }
  }
  listDiff("Workspace event", before.contracts.events, after.contracts.events);
  listDiff("Workspace pane", before.contracts.panes, after.contracts.panes);
  listDiff("HTTP route", before.contracts.routes, after.contracts.routes);
  listDiff("Socket service", before.contracts.sockets, after.contracts.sockets);
  for (const name of new Set([
    ...Object.keys(before.contracts.schemas),
    ...Object.keys(after.contracts.schemas),
  ])) {
    const was = before.contracts.schemas[name] ?? 0;
    const now = after.contracts.schemas[name] ?? 0;
    if (was !== now) contracts.push(`- Table schema: \`${name}\` ${was} → ${now} versions`);
  }

  const list = (names: Iterable<string>) => [...names].sort(byText).join(", ");
  const [wasContracts, nowContracts] = [subsystemContracts(before), subsystemContracts(after)];
  for (const owner of [...new Set([...wasContracts.keys(), ...nowContracts.keys()])].sort(byText)) {
    const was = wasContracts.get(owner) ?? new Map<string, Set<string>>();
    const now = nowContracts.get(owner) ?? new Map<string, Set<string>>();
    for (const name of [...new Set([...was.keys(), ...now.keys()])].sort(byText)) {
      const a = was.get(name) ?? new Set<string>();
      const b = now.get(name) ?? new Set<string>();
      const gained = [...b].filter((user) => !a.has(user));
      const lost = [...a].filter((user) => !b.has(user));
      const line = `- \`${owner}\` contract:`;
      if (!a.size) contracts.push(`${line} added \`${name}\`, used by ${list(b)}`);
      else if (!b.size) contracts.push(`${line} removed \`${name}\`, which ${list(a)} used`);
      else if (gained.length || lost.length) {
        const notes = [
          ...(gained.length ? [`now also used by ${list(gained)}`] : []),
          ...(lost.length ? [`no longer used by ${list(lost)}`] : []),
        ];
        contracts.push(`${line} \`${name}\` ${notes.join(", and ")}`);
      }
    }
  }

  const changes: Change[] = [];
  const note = (entity: Entity, line: string) =>
    changes.push({ subsystem: subsystem(entity.file), line });
  const label = (e: Entity) => `\`${e.name}${"signature" in e ? e.signature : ""}\` ${e.kind}`;
  const shape = (e: Entity) =>
    "signature" in e ? e.signature : JSON.stringify(e.members) + e.text;
  const groups: [Record<string, Entity>, Record<string, Entity>][] = [
    [before.nouns, after.nouns],
    [before.verbs, after.verbs],
  ];
  for (const [was, now] of groups) {
    const removed = Object.keys(was).filter((id) => !(id in now));
    for (const id of Object.keys(now).filter((id) => !(id in was))) {
      const entity = now[id]!;
      const moved = removed.find((r) => was[r]!.name === entity.name);
      // Of the same-shaped candidates in the file, a rename keeps the most words of its name.
      const renamed = removed
        .filter(
          (r) =>
            was[r]!.file === entity.file &&
            was[r]!.kind === entity.kind &&
            shape(was[r]!) === shape(entity),
        )
        .sort(
          (a, b) => sharedWords(was[b]!.name, entity.name) - sharedWords(was[a]!.name, entity.name),
        )[0];
      const match = moved ?? renamed;
      if (match) removed.splice(removed.indexOf(match), 1);
      if (moved)
        note(
          entity,
          `- **Moved** ${label(entity)} from \`${was[moved]!.file}\` to \`${entity.file}\``,
        );
      else if (renamed)
        note(
          entity,
          `- **Renamed** \`${was[renamed]!.name}\` to ${label(entity)} in \`${entity.file}\``,
        );
      else
        note(
          entity,
          `- **Added** ${label(entity)} in \`${entity.file}\`${reachNote(after, id, entity.file)}`,
        );
    }
    for (const id of removed)
      note(was[id]!, `- **Removed** ${label(was[id]!)} from \`${was[id]!.file}\``);
    for (const id of Object.keys(now).filter((id) => id in was)) {
      const a = was[id]!;
      const b = now[id]!;
      const notes: string[] = [];
      if ("signature" in a && "signature" in b) {
        if (a.signature !== b.signature) notes.push(signatureChange(a, b));
      } else if (!("signature" in a) && !("signature" in b)) {
        for (const m of Object.keys(b.members)) if (!(m in a.members)) notes.push(`+${m}`);
        for (const m of Object.keys(a.members)) if (!(m in b.members)) notes.push(`−${m}`);
        for (const m of Object.keys(b.members)) {
          if (a.members[m] && b.members[m] && a.members[m] !== b.members[m])
            notes.push(`~${m} ${excerpt(a.members[m]!, b.members[m]!)}`);
        }
        if (!notes.length && a.text !== b.text) notes.push(excerpt(a.text, b.text));
      }
      if (notes.length) note(b, `- **Reshaped** \`${b.name}\` ${b.kind}: ${notes.join(", ")}`);
    }
  }
  return { contracts, changes };
}

/** A verb's added and removed parameter names when its parameters keep their positions. */
function signatureChange(a: Verb, b: Verb): string {
  const count = (signature: string) =>
    signature.replace(/\{[^}]*\}|\[[^\]]*\]/g, "_").split(",").length;
  if (count(a.signature) !== count(b.signature)) {
    return `\`${a.name}${a.signature}\` → \`${b.name}${b.signature}\``;
  }
  const names = (signature: string): string[] => signature.match(/[\w$.]+\??/g) ?? [];
  const was = names(a.signature);
  const now = names(b.signature);
  return [
    ...now.filter((n) => !was.includes(n)).map((n) => `+${n}`),
    ...was.filter((n) => !now.includes(n)).map((n) => `−${n}`),
  ].join(", ");
}

/** Two versions of a long string, trimmed to what changed with a little context. */
function excerpt(before: string, after: string): string {
  let start = 0;
  while (start < before.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before.at(-1 - end) === after.at(-1 - end)
  )
    end++;
  const from = Math.max(0, start - 20);
  const trim = (text: string) => {
    const to = Math.min(text.length, text.length - end + 20);
    return `${from ? "…" : ""}${text.slice(from, to)}${to < text.length ? "…" : ""}`;
  };
  return `\`${trim(before) || "∅"}\` → \`${trim(after) || "∅"}\``;
}

type Row = { file: string; added: number; removed: number };

/** Lines added and removed per file, against a git ref or another copy of the tree. */
async function changedFiles(base: string): Promise<Row[]> {
  const numstat = (text: string) =>
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\t"))
      .map(([added, removed, file]) => ({
        file: file!,
        added: +added! || 0,
        removed: +removed! || 0,
      }));
  if (!(await isDirectory(base))) {
    const untracked = (await $`git ls-files --others --exclude-standard`.text()).split("\n");
    const added = untracked.filter(Boolean).map(async (file) => ({
      file,
      added: (await Bun.file(file).text()).split("\n").length - 1,
      removed: 0,
    }));
    return [...numstat(await $`git diff --numstat ${base}`.text()), ...(await Promise.all(added))];
  }
  // Both trees' files under the repo's own ignore rules: the base's, and any only this copy has.
  const lines = (text: string) => text.split("\n").filter(Boolean);
  const files = new Set([
    ...lines(await $`git -C ${base} ls-files -co --exclude-standard`.text()),
    ...lines(
      await $`git --git-dir=${join(base, ".git")} --work-tree=. ls-files -o --exclude-standard`.text(),
    ),
  ]);
  const rows: Row[] = [];
  for (const file of files) {
    const [was, now] = [join(base, file), file].map((path) => Bun.file(path));
    const [a, b] = await Promise.all(
      [was!, now!].map(async (f) => ((await f.exists()) ? f.text() : "")),
    );
    if (a === b) continue;
    const paths = [a ? join(base, file) : "/dev/null", b ? file : "/dev/null"];
    const [row] = numstat(await $`git diff --no-index --numstat ${paths}`.nothrow().text());
    if (row) rows.push({ ...row, file });
  }
  return rows;
}

async function sizeAgainst(base: string): Promise<string[]> {
  const rows = await changedFiles(base);
  const kindOf = (file: string) =>
    /bun\.lock|\/codex\/protocol\/|routeTree\.gen/.test(file)
      ? "generated"
      : /^(evals|scripts)\//.test(file) && !isTest(file)
        ? "tooling"
        : isTest(file)
          ? "tests"
          : file.endsWith(".md")
            ? "docs"
            : "production";
  type Tally = { added: number; removed: number; files: number };
  const tally = (into: Map<string, Tally>, key: string, row: (typeof rows)[number]) => {
    const t = into.get(key) ?? { added: 0, removed: 0, files: 0 };
    into.set(key, {
      added: t.added + row.added,
      removed: t.removed + row.removed,
      files: t.files + 1,
    });
  };
  const kinds = new Map<string, Tally>();
  const production = new Map<string, Tally>();
  for (const row of rows) {
    tally(kinds, kindOf(row.file), row);
    if (kindOf(row.file) === "production") tally(production, subsystem(row.file), row);
  }
  const net = ({ added, removed, files }: Tally) =>
    `+${added} −${removed}, net ${added >= removed ? "+" : ""}${added - removed}, ${files} files`;
  return [
    ...["production", "tests", "docs", "tooling", "generated"]
      .filter((kind) => kinds.has(kind))
      .map((kind) => `- **${kind}:** ${net(kinds.get(kind)!)}`),
    "",
    "Production by subsystem:",
    "",
    ...[...production]
      .sort(([, a], [, b]) => b.added + b.removed - (a.added + a.removed))
      .map(([name, t]) => `- ${name}: ${net(t)}`),
  ];
}

async function readModelAt(ref: string): Promise<DomainModel> {
  if (await isDirectory(ref)) return readModel(resolve(ref));
  const dir = await mkdtemp(join(tmpdir(), "domain-"));
  try {
    await $`git archive ${ref} src evals tests tsconfig.json | tar -x -C ${dir}`.quiet();
    await symlink(join(process.cwd(), "node_modules"), join(dir, "node_modules"));
    return readModel(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// ── Map ────────────────────────────────────────────────────────────────

/** Where a verb runs: the pure model, the server, or the client. */
const layerOf = (file: string) =>
  /\/model\//.test(file) ? "model" : /\/server\/|^src\/server\//.test(file) ? "server" : "client";

export function mapModel(model: DomainModel, areas: string[]): string[] {
  const entities = [...Object.values(model.nouns), ...Object.values(model.verbs)];
  const names = [...new Set(entities.map((e) => subsystem(e.file)))]
    .filter((name) => !areas.length || areas.includes(name))
    .sort(byText);
  const nameOf = (id: string) => id.slice(id.indexOf("#") + 1);
  const byFile = <T extends Entity>([, a]: [string, T], [, b]: [string, T]) =>
    a.file.localeCompare(b.file) || a.name.localeCompare(b.name);
  return names.flatMap((name) => {
    const inside = <T extends Entity>([, e]: [string, T]) => subsystem(e.file) === name;
    const nouns = Object.entries(model.nouns).filter(inside).sort(byFile);
    const all = Object.entries(model.verbs).filter(inside).sort(byFile);
    const verbs = all.filter(([, e]) => !e.kind.startsWith("constructor"));
    const constructors = all.filter(([, e]) => e.kind.startsWith("constructor"));
    const rpc = Object.entries(model.contracts.rpc)
      .filter(([key]) => key.startsWith(`${name}.`))
      .map(([key, fields]) => `- \`${key.slice(name.length + 1)}\`(${fields.join(", ")})`);
    const contract = [...(subsystemContracts(model).get(name) ?? [])]
      .sort(([a], [b]) => byText(a, b))
      .map(([entity, users]) => `- \`${entity}\`, used by ${[...users].sort(byText).join(", ")}`);
    const dependsOn = new Set<string>();
    for (const [, verb] of verbs) {
      for (const id of verb.uses) if (subsystem(id) !== name) dependsOn.add(subsystem(id));
    }
    return [
      `## ${name}`,
      "",
      `${nouns.length} nouns, ${constructors.length} constructors, and ${verbs.length} verbs, of which ${contract.length} are its contract with other subsystems and the rest are internal.`,
      "",
      `- **Uses nouns from:** ${[...dependsOn].sort(byText).join(", ") || "none"}`,
      "",
      "### Contract",
      "",
      ...(contract.length ? contract : ["None."]),
      "",
      "### Nouns",
      "",
      ...nouns.map(([, e]) => {
        const members = Object.keys(e.members);
        const shape = members.length ? `: ${members.join(", ")}` : e.text ? `: \`${e.text}\`` : "";
        const built = constructors.filter(([, c]) => c.kind === `constructor of ${e.name}`);
        const by = built.map(([, c]) => `\`${c.name}${c.signature}\``).join(", ");
        return `- \`${e.name}\` ${e.kind} in \`${e.file}\`${shape}${by ? `, built by ${by}` : ""}`;
      }),
      "",
      ...(["model", "server", "client"] as const).flatMap((layer) => {
        const inLayer = verbs.filter(([, e]) => layerOf(e.file) === layer);
        if (!inLayer.length) return [];
        return [
          `### ${layer[0]!.toUpperCase()}${layer.slice(1)} verbs`,
          "",
          ...inLayer.map(([id, e]) => {
            const uses = e.uses.map(nameOf).filter((n) => n !== e.name.split(".")[0]);
            const over = uses.length ? ` over ${uses.map((n) => `\`${n}\``).join(", ")}` : "";
            return `- \`${e.name}${e.signature}\` ${e.kind}${over}${reachNote(model, id, e.file)}`;
          }),
          "",
        ];
      }),
      ...(rpc.length ? ["### Server functions", "", ...rpc, ""] : []),
    ];
  });
}

// ── Command line ───────────────────────────────────────────────────────

if (import.meta.main) {
  const [command = "diff", ...args] = process.argv.slice(2);
  if (command === "diff") {
    const ref = args[0] ?? "HEAD";
    const [before, size] = await Promise.all([readModelAt(ref), sizeAgainst(ref)]);
    const { contracts, changes } = diffModels(before, readModel(process.cwd()));
    const areas = [...new Set(changes.map((change) => change.subsystem))].sort(byText);
    const report = [
      `# Domain diff against ${ref}`,
      "",
      "## Size",
      "",
      ...size,
      "",
      "## Contracts",
      "",
      ...(contracts.length ? contracts : ["No change."]),
      "",
      "## Nouns and verbs",
      "",
      ...areas.flatMap((area) => [
        `### ${area}`,
        "",
        ...changes.filter((change) => change.subsystem === area).map((change) => change.line),
        "",
      ]),
    ];
    console.log(report.join("\n"));
  } else if (command === "map") {
    const model = readModel(process.cwd());
    const areas = args.filter((arg) => !arg.startsWith("--"));
    console.log(
      args.includes("--json")
        ? JSON.stringify(model, null, 2)
        : ["# Domain map", "", ...mapModel(model, areas)].join("\n"),
    );
  } else {
    console.error("Usage: bun run domain diff [ref] | bun run domain map [area…] [--json]");
    process.exit(1);
  }
}
