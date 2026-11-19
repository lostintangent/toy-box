import type { CopilotSession, SessionEvent as SdkEvent } from "@microsoft/copilot-sdk";
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
  let sending: Promise<unknown> | undefined;
  /** Settles once the CLI takes up the send that starts a turn. */
  let starting: (ReturnType<typeof Promise.withResolvers<void>> & { clientId: string }) | undefined;
  // Registered before onEvent's forward, so the idle that ends a turn settles before the runtime
  // drains the next send in response, which would otherwise lose its wait to that same idle.
  native.on((event) => {
    if (starting && takesUp(event, starting.clientId)) {
      starting.resolve();
      starting = undefined;
    }
  });
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
      const turn = message.immediate
        ? undefined
        : (starting = { clientId: message.clientId, ...Promise.withResolvers<void>() });
      sending = native.send({
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
      // A rejected send starts no turn.
      await sending.catch((error: unknown) => {
        turn?.resolve();
        throw error;
      });
    },
    // The native switch keeps an effort it omits, so a configuration without one clears it.
    async setModel(model: ModelConfiguration) {
      await native.rpc.model.switchTo({
        modelId: model.name,
        ...toSdkSetModelOptions(model),
        reasoningEffort: model.reasoningEffort ?? null,
      });
    },
    async answerQuestion({ requestId, answer, wasFreeform }) {
      return (
        await native.rpc.ui.handlePendingUserInput({ requestId, response: { answer, wasFreeform } })
      ).success;
    },
    // Native abort cancels the input the CLI has admitted but not taken up, so the send that starts
    // a turn stays in history only once taken up. The SDK writes a send only after preparing it, so
    // steers wait for their admission.
    async abort() {
      await sending?.catch(() => undefined);
      await starting?.promise;
      await native.abort();
    },
    disconnect() {
      starting?.resolve();
      return native.disconnect();
    },
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

/** The CLI takes up a send when it records it. A turn that ends retires one it never took up. */
function takesUp(event: SdkEvent, clientId: string): boolean {
  if (event.type === "user.message") return event.data.clientTurnId === clientId;
  return event.type === "session.idle" || (event.type === "session.error" && !event.agentId);
}

type SdkSetModelOptions = NonNullable<Parameters<CopilotSession["setModel"]>[1]>;

// The SDK's context tier union is narrower than live metadata, so it is cast at the boundary.
export function toSdkSetModelOptions(configuration?: ModelConfiguration): SdkSetModelOptions {
  return {
    ...(configuration?.reasoningEffort ? { reasoningEffort: configuration.reasoningEffort } : {}),
    ...(configuration?.contextTier
      ? { contextTier: configuration.contextTier as SdkSetModelOptions["contextTier"] }
      : {}),
  };
}
