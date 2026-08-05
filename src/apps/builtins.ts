import kanbanTsx from "./kanban/app.tsx?raw";
import squadTsx from "./squad/app.tsx?raw";
import type { AppDefinition } from "@/types";

export const BUILT_IN_APP_DEFINITIONS: Array<Omit<AppDefinition, "revision"> & { tsx: string }> = [
  {
    id: "toybox-kanban",
    title: "Kanban Board",
    description: "A session-aware board for turning cards into agent work.",
    icon: "Kanban",
    color: "#f59e0b",
    accepts: [],
    tsx: kanbanTsx,
    state: {
      schema: {
        $defs: {
          column: {
            type: "object",
            properties: {
              id: {
                type: "string",
                minLength: 1,
                description: "Stable identifier unique among the board's columns.",
              },
              title: {
                type: "string",
                minLength: 1,
                description: "User-facing column name.",
              },
              tone: {
                enum: ["neutral", "accent", "success"],
                description: "Visual treatment for this workflow stage.",
              },
            },
            required: ["id", "title", "tone"],
            additionalProperties: false,
          },
          model: {
            type: "object",
            properties: {
              name: {
                type: "string",
                minLength: 1,
                description: "Model identifier used when this card starts a session.",
              },
              reasoningEffort: {
                type: "string",
                description: "Optional reasoning effort used with the selected model.",
              },
            },
            required: ["name"],
            additionalProperties: false,
          },
          card: {
            type: "object",
            properties: {
              id: {
                type: "string",
                minLength: 1,
                description: "Stable identifier unique among the board's cards.",
              },
              columnId: {
                type: "string",
                minLength: 1,
                description:
                  "ID of an existing column. Change this field to move the card between workflow stages.",
              },
              title: { type: "string", minLength: 1, description: "Concise task title." },
              prompt: { type: "string", description: "Detailed task instructions." },
              model: { $ref: "#/$defs/model" },
              directory: {
                type: "string",
                minLength: 1,
                description: "Optional directory where the card's session should work.",
              },
              useWorktree: {
                const: true,
                description:
                  "Run the session in a worktree; include only when directory is present.",
              },
              sessionId: {
                type: "string",
                minLength: 1,
                description:
                  "ID of the ordinary top-level session coordinating this card. The card owns and deletes this session; never attach a worker or another managed session.",
              },
            },
            required: ["id", "columnId", "title", "prompt"],
            additionalProperties: false,
          },
        },
        type: "object",
        properties: {
          columns: {
            type: "array",
            description: "Ordered workflow columns whose IDs are unique within this board.",
            items: { $ref: "#/$defs/column" },
          },
          cards: {
            type: "array",
            description:
              "Board cards whose IDs are unique and whose columnId always references an existing column.",
            items: { $ref: "#/$defs/card" },
          },
        },
        required: ["columns", "cards"],
        additionalProperties: false,
      },
      default: {
        columns: [
          { id: "backlog", title: "Backlog", tone: "neutral" },
          { id: "active", title: "In progress", tone: "accent" },
          { id: "done", title: "Done", tone: "success" },
        ],
        cards: [],
      },
    },
  },
  {
    id: "toybox-squad",
    title: "Squad Board",
    description: "Launch and observe session-native agent squads from one live control surface.",
    icon: "Bot",
    color: "#6366f1",
    accepts: ["x-session-launch"],
    tsx: squadTsx,
    state: {
      schema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      default: {},
    },
  },
];
