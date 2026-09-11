import { describe, expect, test } from "bun:test";
import type { FlowExhibit, IntentDocument } from "../schema";
import { fixture, flowExhibit, parse } from "../testFixtures";
import { entityFlowConnections, flowGraph } from "./flow";

function changedFlow(change: (flow: FlowExhibit) => void): IntentDocument {
  const document = structuredClone(fixture());
  change(flowExhibit(document, "shared-rendering-flow"));
  return document;
}

describe("intent flow", () => {
  test("projects shared requirements and local waypoints through authored paths", () => {
    const document = changedFlow((flow) => {
      flow.nodes.push({
        id: "rendered-result",
        title: "Rendered result",
        description: "The local endpoint of the fallback route.",
      });
      flow.connections.push({
        id: "fallback-produces-result",
        from: "fallback-owner",
        to: "rendered-result",
        label: "produces",
      });
      flow.paths[0]!.connectionIds.push("fallback-produces-result");
      flow.regions![1]!.nodeIds.push("rendered-result");
    });
    const parsed = parse(document);
    if (!parsed.ok) throw new Error(parsed.error);

    const flow = flowExhibit(parsed.value, "shared-rendering-flow");
    const graph = flowGraph(parsed.value, flow);
    expect(graph.stages.map((stage) => stage.map((node) => node.id))).toEqual([
      ["ordinary-tools"],
      ["fallback-owner", "block"],
      ["rendered-result"],
    ]);
    expect(graph.paths[0]?.connections.map((connection) => connection.id)).toEqual([
      "ordinary-tools-preserve-fallback",
      "fallback-produces-result",
    ]);
    expect(graph.regions[1]?.nodes.map((node) => node.id)).toEqual([
      "fallback-owner",
      "block",
      "rendered-result",
    ]);
    expect(
      graph.stages.flat().find((node) => node.id === "rendered-result")?.entity,
    ).toBeUndefined();

    expect(
      entityFlowConnections(parsed.value, "fallback-owner").map(
        ({ flow: owner, connection, outgoing, related }) => ({
          flow: owner.id,
          connection: connection.id,
          outgoing,
          related: related.id,
        }),
      ),
    ).toEqual([
      {
        flow: "shared-rendering-flow",
        connection: "fallback-produces-result",
        outgoing: true,
        related: "rendered-result",
      },
      {
        flow: "shared-rendering-flow",
        connection: "ordinary-tools-preserve-fallback",
        outgoing: false,
        related: "ordinary-tools",
      },
    ]);
  });

  test("rejects flows whose owned graph cannot be followed honestly", () => {
    const cases: Array<{
      name: string;
      error: string;
      document: IntentDocument;
    }> = [
      {
        name: "unknown shared requirement",
        error: 'Unknown entity reference "missing-requirement"',
        document: changedFlow((flow) => {
          flow.nodes[0] = { entity: "missing-requirement" };
        }),
      },
      {
        name: "self as a shared requirement",
        error: "cannot contain itself as a shared node",
        document: changedFlow((flow) => {
          flow.nodes[0] = { entity: flow.id };
        }),
      },
      {
        name: "duplicate node identity",
        error: "Nodes in flow",
        document: changedFlow((flow) => {
          flow.nodes.push({ entity: "ordinary-tools" });
        }),
      },
      {
        name: "unknown endpoint",
        error: 'references unknown node "missing-node"',
        document: changedFlow((flow) => {
          flow.connections[0]!.to = "missing-node";
        }),
      },
      {
        name: "orphan node",
        error: "is not used by a connection",
        document: changedFlow((flow) => {
          flow.nodes.push({ id: "orphan", title: "Orphan" });
        }),
      },
      {
        name: "unknown path connection",
        error: 'references unknown connection "missing-connection"',
        document: changedFlow((flow) => {
          flow.paths[0]!.connectionIds = ["missing-connection"];
        }),
      },
      {
        name: "supporting connection with unplaced endpoints",
        error: "must connect nodes already placed by a path",
        document: changedFlow((flow) => {
          flow.nodes.push({ id: "aside-a", title: "Aside A" }, { id: "aside-b", title: "Aside B" });
          flow.connections.push({
            id: "aside-connection",
            from: "aside-a",
            to: "aside-b",
            label: "relates to",
          });
        }),
      },
      {
        name: "cycle",
        error: "contain a cycle",
        document: changedFlow((flow) => {
          flow.connections.push({
            id: "block-returns-to-tools",
            from: "block",
            to: "ordinary-tools",
            label: "returns to",
          });
          flow.paths[1]!.connectionIds.push("block-returns-to-tools");
        }),
      },
      {
        name: "node in two regions",
        error: "Region members in flow",
        document: changedFlow((flow) => {
          flow.regions![0]!.nodeIds.push("fallback-owner");
        }),
      },
    ];

    for (const item of cases) {
      const parsed = parse(item.document);
      expect(parsed.ok, item.name).toBe(false);
      if (!parsed.ok) expect(parsed.error, item.name).toContain(item.error);
    }
  });
});
