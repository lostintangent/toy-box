import {
  channelIdentitySchema,
  markChannelReadInputSchema,
  postChannelMessageInputSchema,
} from "@channels/model";
import { createSseResponse } from "@/shared/server/sse";
import { getChannelHistory, markChannelRead, postChannelMessage } from ".";
import { streamChannel } from "./stream";

/** HTTP ingress over the public Channel capabilities. */
export function getChannelResponse(channelId: string, request: Request): Response {
  if (!channelIdentitySchema.safeParse({ channelId }).success) return invalidRequest();
  return createSseResponse(request, (send, close) =>
    streamChannel(
      channelId,
      (event) =>
        send(
          event,
          event.type === "snapshot"
            ? event.state.revision
            : "revision" in event
              ? event.revision
              : undefined,
        ),
      close,
      readAfterRevision(request),
    ),
  );
}

function readAfterRevision(request: Request): number | undefined {
  const value =
    request.headers.get("last-event-id") ?? new URL(request.url).searchParams.get("after");
  if (value === null || value.trim() === "") return undefined;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : undefined;
}

export async function getChannelHistoryResponse(
  channelId: string,
  request: Request,
): Promise<Response> {
  const before = Number(new URL(request.url).searchParams.get("before"));
  if (
    !channelIdentitySchema.safeParse({ channelId }).success ||
    !Number.isSafeInteger(before) ||
    before <= 0
  )
    return invalidRequest();
  const page = await getChannelHistory(channelId, before);
  return page
    ? Response.json({ version: 1, ...page }, { headers: { "Cache-Control": "no-store" } })
    : missingChannel();
}

export async function postChannelMessageResponse(
  channelId: string,
  request: Request,
): Promise<Response> {
  const input = await readInput(channelId, request, postChannelMessageInputSchema);
  if (!input) return invalidRequest();
  try {
    return Response.json({ version: 1, message: await postChannelMessage(input) }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "SQLITE_CONSTRAINT_PRIMARYKEY"
    ) {
      return Response.json({ error: "Message ID already exists." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "Channel not found.") return missingChannel();
    console.error(`Failed to post to Channel ${channelId}:`, error);
    return Response.json({ error: "Unable to post Channel message." }, { status: 500 });
  }
}

export async function markChannelReadResponse(
  channelId: string,
  request: Request,
): Promise<Response> {
  const input = await readInput(channelId, request, markChannelReadInputSchema);
  if (!input) return invalidRequest();
  try {
    const channel = await markChannelRead(input.channelId, input.sequence);
    if (!channel) return missingChannel();
    return Response.json({ version: 1, seenThrough: channel.seenThrough });
  } catch (error) {
    console.error(`Failed to mark Channel ${channelId} read:`, error);
    return Response.json({ error: "Unable to mark Channel read." }, { status: 500 });
  }
}

/** Command bodies cannot override the Channel named by the route. */
async function readInput<T>(
  channelId: string,
  request: Request,
  schema: { parse(input: unknown): T },
) {
  try {
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
      return;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body) || "channelId" in body) return;
    return schema.parse({ ...body, channelId });
  } catch {
    return;
  }
}

function invalidRequest(): Response {
  return Response.json({ error: "Invalid Channel request." }, { status: 400 });
}

function missingChannel(): Response {
  return Response.json({ error: "Channel not found." }, { status: 404 });
}
