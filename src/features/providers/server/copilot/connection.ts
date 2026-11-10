import type {
  CopilotSession,
  SessionConfig as SdkSessionConfig,
  SessionEvent as SdkEvent,
} from "@github/copilot-sdk";
import type { ModelConfiguration } from "@providers/model";
import type { SessionConnection } from "@providers/server/provider";
import { encodeSystemMessage, systemMessagePrompt } from "@sessions/model/systemMessages";
import { toSdkAttachments } from "./attachments";
import { createSdkEventProjector } from "./projector";

/** The first subscriber receives persisted native events, such as start and resume, that precede it. */
export function holdNativeEvents() {
  let held: SdkEvent[] | undefined = [];
  return {
    onEvent: (event: SdkEvent) => {
      if (!event.ephemeral) held?.push(event);
    },
    release() {
      const events = held ?? [];
      held = undefined;
      return events;
    },
  };
}

/** Native SDK event and RPC details never cross the Sessions contract. */
export function connectCopilotSession(
  native: CopilotSession,
  early: ReturnType<typeof holdNativeEvents>,
): SessionConnection {
  return {
    nativeId: native.sessionId,
    onEvent(listener) {
      const project = createSdkEventProjector();
      const forward = (event: SdkEvent) => {
        if (event.type === "session.idle") listener({ type: "end", reason: "idle" });
        else if (event.type === "abort") listener({ type: "end", reason: "error" });
        else for (const projected of project(event)) listener(projected);
      };
      for (const event of early.release()) forward(event);
      return native.on(forward);
    },
    async send(message) {
      await native.send({
        ...(message.role === "system"
          ? {
              prompt: systemMessagePrompt(message.content),
              displayPrompt: encodeSystemMessage(message.content),
              source: "system",
            }
          : {
              prompt: message.content,
              attachments: toSdkAttachments(message.attachments),
            }),
        ...(message.immediate ? { mode: "immediate" } : {}),
        clientTurnId: message.clientId,
      });
    },
    async setModel(model: ModelConfiguration) {
      await native.setModel(model.name, toSdkSetModelOptions(model));
    },
    async answerQuestion({ requestId, answer, wasFreeform }) {
      return (
        await native.rpc.ui.handlePendingUserInput({ requestId, response: { answer, wasFreeform } })
      ).success;
    },
    // Native abort also cancels queued and steering input.
    abort: () => native.abort(),
    disconnect: () => native.disconnect(),
    async rename(name, automatic) {
      if (automatic) return (await native.rpc.name.setAuto({ summary: name })).applied;
      await native.rpc.name.set({ name });
      return true;
    },
    async rewind(timestamp) {
      const { points } = await native.rpc.history.listRewindPoints();
      const point = points.find((candidate) => candidate.timestamp === timestamp);
      if (!point) throw new Error("That message is no longer available to rewind.");
      const { eventsRemoved } = await native.rpc.history.rewind({
        eventId: point.eventId,
        mode: "conversation",
      });
      if (eventsRemoved === undefined) throw new Error("Session rewind failed.");
    },
  };
}

type SdkSetModelOptions = NonNullable<Parameters<CopilotSession["setModel"]>[1]>;

// The SDK's context tier union is narrower than live metadata, so it is cast at the boundary.
export function toSdkSetModelOptions(configuration?: ModelConfiguration): SdkSetModelOptions {
  return {
    ...(configuration?.reasoningEffort ? { reasoningEffort: configuration.reasoningEffort } : {}),
    ...(configuration?.contextTier
      ? { contextTier: configuration.contextTier as SdkSessionConfig["contextTier"] }
      : {}),
  };
}
