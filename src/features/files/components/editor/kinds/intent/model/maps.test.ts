import { describe, expect, test } from "bun:test";
import { projectedRecords } from "./projection";
import { intentMapGraph, intentMapRelations } from "./maps";
import { chooseOption } from "./transitions";
import {
  fixture,
  mapSection,
  parse,
  sequencedFixture,
  sharedRenderingPathsMap,
} from "./testFixtures";

describe("intent maps", () => {
  test("validates task-defined map references and selectors", () => {
    const unknownRoot = structuredClone(fixture());
    const rootMap = mapSection(unknownRoot, "shared-rendering-path");
    if (rootMap.layout === "paths") throw new Error("Expected staged map");
    rootMap.roots = ["missing"];
    expect(parse(unknownRoot)).toMatchObject({ ok: false });

    const deliveryRelation = structuredClone(sequencedFixture());
    deliveryRelation.sections.push({
      id: "invalid-delivery-map",
      title: "Invalid delivery map",
      purpose: "Try to use a delivery-only relationship as a domain reading.",
      kind: "map",
      collapsed: false,
      layout: "flow",
      relations: ["changed-implemented-by-integration"],
    });
    expect(parse(deliveryRelation)).toMatchObject({
      ok: false,
      error: expect.stringContaining("delivery-only"),
    });
  });

  test("validates rooted path maps, supporting feedback, and regions", () => {
    const valid = chooseOption(fixture(), "diff-treatment", "shared");
    valid.relations.push({
      id: "fallback-points-back-to-tools",
      from: "fallback-owner",
      to: "ordinary-tools",
      kind: "preserves",
      label: "keeps the escape hatch",
    });
    const map = sharedRenderingPathsMap();
    if (map.layout !== "paths") throw new Error("Expected path map");
    map.relations = ["fallback-points-back-to-tools"];
    valid.sections.push(map);
    expect(parse(valid)).toMatchObject({ ok: true });

    const disconnected = structuredClone(valid);
    const disconnectedMap = mapSection(disconnected, "shared-rendering-routes");
    if (disconnectedMap.layout !== "paths") throw new Error("Expected path map");
    disconnectedMap.paths[0]!.root = "fallback-owner";
    expect(parse(disconnected)).toMatchObject({
      ok: false,
      error: expect.stringContaining("not reachable outward"),
    });

    const unsupported = structuredClone(valid);
    unsupported.relations.push({
      id: "block-realizes-tool-call",
      from: "block",
      to: "tool-call",
      kind: "realized-by",
    });
    const unsupportedMap = mapSection(unsupported, "shared-rendering-routes");
    if (unsupportedMap.layout !== "paths") throw new Error("Expected path map");
    unsupportedMap.relations = ["block-realizes-tool-call"];
    expect(parse(unsupported)).toMatchObject({
      ok: false,
      error: expect.stringContaining("already placed by a path"),
    });

    const repeatedRegionMember = structuredClone(valid);
    const repeatedRegionMap = mapSection(repeatedRegionMember, "shared-rendering-routes");
    if (repeatedRegionMap.layout !== "paths") throw new Error("Expected path map");
    repeatedRegionMap.regions?.push({
      id: "another-entry",
      title: "Another entry",
      entities: ["ordinary-tools"],
    });
    expect(parse(repeatedRegionMember)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Region members"),
    });

    const cyclic = chooseOption(fixture(), "diff-treatment", "shared");
    cyclic.relations.push({
      id: "fallback-points-back-to-tools",
      from: "fallback-owner",
      to: "ordinary-tools",
      kind: "preserves",
    });
    const cyclicMap = sharedRenderingPathsMap();
    if (cyclicMap.layout !== "paths") throw new Error("Expected path map");
    cyclicMap.paths[0]!.relations.push("fallback-points-back-to-tools");
    cyclic.sections.push(cyclicMap);
    expect(parse(cyclic)).toMatchObject({
      ok: false,
      error: expect.stringContaining("contain a cycle"),
    });
  });

  test("projects authored maps and active records", () => {
    const explored = chooseOption(fixture(), "diff-treatment", "shared");
    const map = mapSection(explored, "shared-rendering-path");
    if (map.layout === "paths") throw new Error("Expected staged map");
    expect(intentMapRelations(explored, map).map(({ relation }) => relation.id)).toEqual([
      "ordinary-tools-preserve-fallback",
      "ordinary-tools-use-shared-diff",
    ]);
    expect(
      projectedRecords(explored, "rendering-ownership", ["shared-diff", "fallback-owner"]).map(
        ({ item }) => item.id,
      ),
    ).toEqual(["shared-diff", "fallback-owner"]);

    const graph = intentMapGraph(explored, map);
    expect(graph.stages.map((stage) => stage.map(({ entity }) => entity.id))).toEqual([
      ["ordinary-tools"],
      ["fallback-owner", "shared-diff"],
    ]);
    expect(
      graph.stages
        .flat()
        .flatMap(({ entity }) => entity.id)
        .filter((id) => id === "ordinary-tools"),
    ).toHaveLength(1);

    const multiRootGraph = intentMapGraph(explored, {
      ...map,
      roots: ["ordinary-tools", "fallback-owner"],
    });
    expect(multiRootGraph.stages.map((stage) => stage.map(({ entity }) => entity.id))).toEqual([
      ["ordinary-tools", "fallback-owner"],
      ["shared-diff"],
    ]);
  });

  test("projects available rooted paths, shared nodes, regions, and supporting links", () => {
    const explored = chooseOption(fixture(), "diff-treatment", "shared");
    explored.relations.push({
      id: "fallback-points-back-to-tools",
      from: "fallback-owner",
      to: "ordinary-tools",
      kind: "preserves",
      label: "keeps the escape hatch",
    });
    const map = sharedRenderingPathsMap();
    if (map.layout !== "paths") throw new Error("Expected path map");
    map.relations = ["fallback-points-back-to-tools"];

    const graph = intentMapGraph(explored, map);
    expect(graph.relations.map(({ relation }) => relation.id)).toEqual([
      "ordinary-tools-preserve-fallback",
      "ordinary-tools-use-shared-diff",
      "fallback-points-back-to-tools",
    ]);
    expect(graph.stages.map((stage) => stage.map(({ entity }) => entity.id))).toEqual([
      ["ordinary-tools"],
      ["fallback-owner", "shared-diff"],
    ]);
    expect(graph.paths.map((path) => path.id)).toEqual(["fallback-route", "shared-body-route"]);
    expect(graph.paths.map((path) => path.nodes.map(({ entity }) => entity.id))).toEqual([
      ["ordinary-tools", "fallback-owner"],
      ["ordinary-tools", "shared-diff"],
    ]);
    expect(graph.regions.map((region) => region.nodes.map(({ entity }) => entity.id))).toEqual([
      ["ordinary-tools"],
      ["fallback-owner", "shared-diff"],
    ]);
    expect(
      graph.stages
        .flat()
        .map(({ entity }) => entity.id)
        .filter((id) => id === "ordinary-tools"),
    ).toHaveLength(1);

    const inactiveGraph = intentMapGraph(fixture(), sharedRenderingPathsMap());
    expect(inactiveGraph.paths.map((path) => path.id)).toEqual(["fallback-route"]);
    expect(
      inactiveGraph.regions.map((region) => region.nodes.map(({ entity }) => entity.id)),
    ).toEqual([["ordinary-tools"], ["fallback-owner"]]);
  });
});
