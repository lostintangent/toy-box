// Voice-driven prompt composing.
//
// A voice call is an ephemeral realtime session whose whole job is to fill the
// composer: the agent listens and drives the input through client tools rather
// than answering the user's request itself.

import { useLayoutEffect, useState } from "react";
import { toolDefinition, type AnyClientTool } from "@tanstack/ai";
import { openaiRealtime } from "@tanstack/ai-openai";
import { useRealtimeChat } from "@tanstack/ai-react";
import { z } from "zod";
import { createVoiceToken } from "@/functions/voice";
import { resolveModelConfigurationForModel } from "@/lib/modelConfiguration";
import type { ModelConfiguration, ModelInfo } from "@/types";

/** Current composer state and actions, read through a ref by the voice tools.
 *  Session presence determines whether sending ends the call or leaves it open
 *  to dispatch another Inbox task. */
export type VoiceComposerContext = {
  prompt: string;
  models: ModelInfo[];
  model: ModelConfiguration | null;
  session?: { name: string; lastMessage: string };
  setPrompt: (text: string) => void;
  submitPrompt: () => boolean;
  setModel: (model: ModelConfiguration) => void;
};

// RealtimeClient snapshots its tools at creation. This stable bridge lets those
// tools read the current composer without making React render from mutable state.
class VoiceComposerBridge {
  context: VoiceComposerContext;
  disconnect: (() => Promise<void>) | null = null;

  constructor(context: VoiceComposerContext) {
    this.context = context;
  }

  updateContext(context: VoiceComposerContext) {
    this.context = context;
  }

  updateDisconnect(disconnect: () => Promise<void>) {
    this.disconnect = disconnect;
  }
}

export function useVoiceComposer(context: VoiceComposerContext) {
  const [bridge] = useState(() => new VoiceComposerBridge(context));
  const adapter = openaiRealtime();
  useLayoutEffect(() => {
    bridge.updateContext(context);
  }, [bridge, context]);

  const attachedToSession = context.session !== undefined;
  const getToken = () => createVoiceToken();
  const tools = buildTools(bridge, attachedToSession);
  const instructions = buildInstructions(attachedToSession);

  const { status, connect, disconnect } = useRealtimeChat({
    getToken,
    adapter,
    tools,
    instructions,
  });
  useLayoutEffect(() => {
    bridge.updateDisconnect(disconnect);
  }, [bridge, disconnect]);

  const voiceStatus =
    status === "connecting"
      ? "connecting"
      : status === "connected" || status === "reconnecting"
        ? "connected"
        : "idle";

  return { status: voiceStatus, connect, disconnect };
}

const emptyInputSchema = z.object({});

function buildTools(bridge: VoiceComposerBridge, attachedToSession: boolean): AnyClientTool[] {
  return [
    toolDefinition({
      name: "read_prompt",
      description: "Read the text currently in the composer input.",
      inputSchema: emptyInputSchema,
    }).client(async () => ({ prompt: bridge.context.prompt })),
    toolDefinition({
      name: "write_prompt",
      description: "Replace the composer input with new text to draft or revise the prompt.",
      inputSchema: z.object({ text: z.string() }),
    }).client(async ({ text }) => {
      bridge.context.setPrompt(text);
      return { ok: true };
    }),
    toolDefinition({
      name: "send_prompt",
      description: attachedToSession
        ? "Submit the current composer text to the session. Also ends the voice call."
        : "Run the current composer text as an Inbox task. The call stays open so more tasks can follow.",
      inputSchema: emptyInputSchema,
    }).client(async () => {
      const submitted = bridge.context.submitPrompt();
      return submitted
        ? { ok: true }
        : { ok: false, error: "The composer is empty or not ready to send." };
    }),
    toolDefinition({
      name: "disconnect_call",
      description: "Disconnect the voice call without sending, e.g. when the user is done talking.",
      inputSchema: emptyInputSchema,
    }).client(async () => {
      void bridge.disconnect?.();
      return { ok: true };
    }),
    toolDefinition({
      name: "read_model_settings",
      description:
        "Read the coding agent's current model and reasoning effort, plus the models available with the reasoning efforts each one supports.",
      inputSchema: emptyInputSchema,
    }).client(async () => {
      const { model, models } = bridge.context;
      return {
        currentModel: model?.name ?? "",
        currentReasoningEffort: model?.reasoningEffort ?? "",
        models: models.map((model) => ({
          id: model.id,
          name: model.name,
          reasoningEfforts: [...(model.supportedReasoningEfforts ?? [])],
        })),
      };
    }),
    toolDefinition({
      name: "set_model",
      description:
        "Switch the coding agent's model. Pass a model id from read_model_settings; the reasoning effort adjusts to stay valid for the new model.",
      inputSchema: z.object({ model: z.string() }),
    }).client(async ({ model }) => selectModel(bridge.context, model)),
    toolDefinition({
      name: "set_reasoning_effort",
      description:
        "Set the coding agent's reasoning effort. Use one of the efforts the current model supports, per read_model_settings.",
      inputSchema: z.object({ reasoning_effort: z.string() }),
    }).client(async ({ reasoning_effort }) =>
      selectReasoningEffort(bridge.context, reasoning_effort),
    ),
    ...(attachedToSession
      ? [
          toolDefinition({
            name: "read_session_context",
            description:
              "Read what the user is working on in this session: its name and the most recent message.",
            inputSchema: emptyInputSchema,
          }).client(async () => {
            const { session } = bridge.context;
            return {
              name: session?.name ?? "",
              lastMessage: session?.lastMessage ?? "",
            };
          }),
        ]
      : []),
  ];
}

function buildInstructions(attachedToSession: boolean): string {
  const sessionContext = attachedToSession
    ? `
      This call is attached to a session the user is already working in.
      When the call connects, use read_session_context to learn the session name and latest message.
      Use that context to ground your help without doing the work yourself.
    `
    : "";

  const sendPromptBehavior = attachedToSession
    ? "In an attached session, send_prompt submits the current draft and ends the voice call."
    : "On the workspace home, send_prompt runs the current draft as an Inbox task and the call stays open so the user can dispatch several tasks in a row.";

  return `
    You are a voice assistant inside a coding app's prompt composer.
    Your only job is to help the user dictate and refine a prompt for a coding agent. Never answer the request yourself.
    The coding agent can create sessions and automations and generate markdown and HTML artifacts for review.
    Treat those as built-in capabilities: when the user asks for them, capture the request in the prompt instead of asking which tool or platform to use.

    ${sessionContext}

    Use read_prompt before reading back or sending the draft because the user can type edits while you listen.
    Use write_prompt to set or revise the composer text.
    Use send_prompt only after the user asks to send or otherwise clearly confirms the draft is ready. ${sendPromptBehavior}
    Use disconnect_call to disconnect without sending.

    You can change the coding agent's model and reasoning effort.
    Use read_model_settings before discussing or changing model settings because the user can also change them by hand.
    Then use set_model or set_reasoning_effort when the user asks to switch.
    Keep spoken replies short and confirm edits in a few words.
  `
    .replace(/\s+/g, " ")
    .trim();
}

/** Switch to `modelId`, keeping the reasoning effort valid for the new model.
 *  Pure policy behind the set_model tool; errors are phrased for the agent to
 *  read back and recover in one turn. */
function selectModel(context: VoiceComposerContext, modelId: string) {
  const model = context.models.find((candidate) => candidate.id === modelId);
  if (!model) {
    return {
      ok: false,
      error: `Unknown model "${modelId}". Available: ${context.models
        .map((candidate) => candidate.id)
        .join(", ")}.`,
    };
  }
  const next = resolveModelConfigurationForModel(model, {
    ...context.model,
    name: model.id,
  });
  context.setModel(next);
  return { ok: true, model: next.name, reasoningEffort: next.reasoningEffort };
}

/** Set the reasoning effort, rejecting values the current model doesn't support
 *  so the agent can't land on an invalid combination. */
function selectReasoningEffort(context: VoiceComposerContext, reasoningEffort: string) {
  const configuration = context.model;
  const model = configuration
    ? context.models.find((candidate) => candidate.id === configuration.name)
    : undefined;
  if (!configuration || !model) {
    return { ok: false, error: "No model is selected yet." };
  }
  const supported: string[] = [...(model.supportedReasoningEfforts ?? [])];
  if (supported.length === 0) {
    return { ok: false, error: "The current model has no reasoning effort to set." };
  }
  if (!supported.includes(reasoningEffort)) {
    return {
      ok: false,
      error: `Unsupported reasoning effort "${reasoningEffort}". Supported: ${supported.join(", ")}.`,
    };
  }
  const next: ModelConfiguration = { ...configuration, name: model.id, reasoningEffort };
  context.setModel(next);
  return { ok: true, model: next.name, reasoningEffort: next.reasoningEffort };
}
