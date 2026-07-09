// Server function that mints an ephemeral OpenAI Realtime client secret.
//
// The browser never sees the long-lived OPENAI_API_KEY: this endpoint exchanges
// it server-side for a short-lived ephemeral key (~10 min) scoped to a single
// realtime session, which the client then uses directly for the WebRTC
// handshake. The composer already gates the mic on `environment.voiceEnabled`,
// but we still fail fast here so a missing key surfaces a clear, feature-framed
// error at the RPC boundary instead of an opaque OpenAI 401 later.

import { createServerFn } from "@tanstack/react-start";
import { realtimeToken, type RealtimeToken } from "@tanstack/ai";
import { openaiRealtimeToken } from "@tanstack/ai-openai";

const REALTIME_MODEL = "gpt-realtime";

/** Mint a short-lived OpenAI Realtime ephemeral client secret for the browser. */
export const createVoiceToken = createServerFn({ method: "POST" }).handler(
  async (): Promise<RealtimeToken> => {
    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new Error("Voice is unavailable: OPENAI_API_KEY is not set on the server.");
    }
    return realtimeToken({ adapter: openaiRealtimeToken({ model: REALTIME_MODEL }) });
  },
);
