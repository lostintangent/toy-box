import {
  bookmarkChannelMessageInputSchema,
  channelArtifactIdentitySchema,
  channelIdentitySchema,
  channelRoutineIdentitySchema,
  createChannelInputSchema,
  createChannelMemberInputSchema,
  editChannelInputSchema,
  markChannelReadInputSchema,
  postChannelMessageInputSchema,
  removeChannelMemberInputSchema,
  updateChannelMemberInputSchema,
} from "@channels/model";
import { getModelChoices } from "@providers/server";
import { createSseResponse } from "@/shared/server/sse";
import {
  bookmarkChannelMessage,
  createChannel,
  createChannelMember,
  deleteChannel,
  deleteChannelRoutine,
  editChannel,
  getChannelHistory,
  getChannelMemberProvider,
  isChannelMember,
  markChannelRead,
  postChannelMessage,
  removeChannelArtifact,
  removeChannelMember,
  runChannelRoutine,
  updateChannelMember,
} from ".";
import {
  getChannelCatalog,
  streamChannel,
  streamChannelCatalog,
  type ChannelCatalogEvent,
} from "./stream";
import { ChannelInputError } from "./database";

/** One URL serves the catalog as JSON, or as a stream that opens with the same JSON when asked. */
export async function getChannelsResponse(request: Request): Promise<Response> {
  const wantsStream = request.headers.get("accept")?.includes("text/event-stream") ?? false;
  const response = wantsStream
    ? createSseResponse<ChannelCatalogEvent>(request, (send) => streamChannelCatalog(send))
    : Response.json(await getChannelCatalog(), { headers: { "Cache-Control": "no-store" } });
  response.headers.set("Vary", "Accept");
  return response;
}

export function getChannelResponse(channelId: string, request: Request): Response {
  if (!channelIdentitySchema.safeParse({ channelId }).success) return invalidRequest();
  return createSseResponse(request, (send, close) =>
    streamChannel(channelId, send, close, readAfterRevision(request)),
  );
}

function readAfterRevision(request: Request): number | undefined {
  const value = new URL(request.url).searchParams.get("after");
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
    : notFound("Channel");
}

export async function postChannelMessageResponse(
  channelId: string,
  request: Request,
): Promise<Response> {
  const input = await readInput(request, postChannelMessageInputSchema, { channelId });
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
    return rejected(error, "post Channel message");
  }
}

export async function markChannelReadResponse(
  channelId: string,
  request: Request,
): Promise<Response> {
  const input = await readInput(request, markChannelReadInputSchema, { channelId });
  if (!input) return invalidRequest();
  try {
    const channel = await markChannelRead(input.channelId, input.sequence);
    if (!channel) return notFound("Channel");
    return Response.json({ version: 1, seenThrough: channel.seenThrough });
  } catch (error) {
    return rejected(error, "mark Channel read");
  }
}

/** Bookmarking is idempotent, so either verb succeeds when the message is already in that state. */
export async function bookmarkChannelMessageResponse(
  channelId: string,
  sequence: string,
  bookmarked: boolean,
): Promise<Response> {
  const input = bookmarkChannelMessageInputSchema.safeParse({
    channelId,
    sequence: Number(sequence),
    bookmarked,
  });
  if (!input.success) return invalidRequest();
  try {
    await bookmarkChannelMessage(input.data);
    return noContent();
  } catch (error) {
    return rejected(error, `${bookmarked ? "bookmark" : "unbookmark"} message ${sequence}`);
  }
}

export async function createChannelResponse(request: Request): Promise<Response> {
  const input = await readInput(request, createChannelInputSchema);
  if (!input) return invalidRequest();
  try {
    return Response.json({ version: 1, channel: await createChannel(input) }, { status: 201 });
  } catch (error) {
    return rejected(error, "create a Channel");
  }
}

export async function editChannelResponse(channelId: string, request: Request): Promise<Response> {
  const input = await readInput(request, editChannelInputSchema, { channelId });
  if (!input) return invalidRequest();
  try {
    return Response.json({ version: 1, channel: await editChannel(input) });
  } catch (error) {
    return rejected(error, `edit Channel ${channelId}`);
  }
}

export async function deleteChannelResponse(channelId: string): Promise<Response> {
  if (!channelIdentitySchema.safeParse({ channelId }).success) return invalidRequest();
  try {
    return (await deleteChannel(channelId)) ? noContent() : notFound("Channel");
  } catch (error) {
    return rejected(error, `delete Channel ${channelId}`);
  }
}

export async function createChannelMemberResponse(
  channelId: string,
  request: Request,
): Promise<Response> {
  const input = await readInput(request, createChannelMemberInputSchema, { channelId });
  if (!input) return invalidRequest();
  try {
    return Response.json({ version: 1, member: await createChannelMember(input) }, { status: 201 });
  } catch (error) {
    return rejected(error, `add a member to Channel ${channelId}`);
  }
}

export async function updateChannelMemberResponse(
  channelId: string,
  agentId: string,
  request: Request,
): Promise<Response> {
  const input = await readInput(request, updateChannelMemberInputSchema, { agentId });
  if (!input || !channelIdentitySchema.safeParse({ channelId }).success) return invalidRequest();
  try {
    if (!(await isChannelMember(channelId, agentId))) return notFound("Channel member");
    return Response.json({ version: 1, member: await updateChannelMember(input) });
  } catch (error) {
    return rejected(error, `update member ${agentId}`);
  }
}

export async function removeChannelMemberResponse(
  channelId: string,
  agentId: string,
): Promise<Response> {
  if (
    !channelIdentitySchema.safeParse({ channelId }).success ||
    !removeChannelMemberInputSchema.safeParse({ agentId }).success
  )
    return invalidRequest();
  try {
    if (!(await isChannelMember(channelId, agentId))) return notFound("Channel member");
    await removeChannelMember(agentId, { type: "user" });
    return noContent();
  } catch (error) {
    return rejected(error, `remove member ${agentId}`);
  }
}

export async function runChannelRoutineResponse(
  channelId: string,
  routineId: string,
): Promise<Response> {
  if (!channelRoutineIdentitySchema.safeParse({ channelId, routineId }).success)
    return invalidRequest();
  try {
    return (await runChannelRoutine(channelId, routineId)) ? noContent() : notFound("Routine");
  } catch (error) {
    return rejected(error, `run routine ${routineId}`);
  }
}

export async function deleteChannelRoutineResponse(
  channelId: string,
  routineId: string,
): Promise<Response> {
  if (!channelRoutineIdentitySchema.safeParse({ channelId, routineId }).success)
    return invalidRequest();
  try {
    return (await deleteChannelRoutine(channelId, routineId)) ? noContent() : notFound("Routine");
  } catch (error) {
    return rejected(error, `delete routine ${routineId}`);
  }
}

export async function removeChannelArtifactResponse(
  channelId: string,
  artifactId: string,
): Promise<Response> {
  if (!channelArtifactIdentitySchema.safeParse({ channelId, artifactId }).success)
    return invalidRequest();
  try {
    return (await removeChannelArtifact(channelId, artifactId, { type: "user" }))
      ? noContent()
      : notFound("Artifact");
  } catch (error) {
    return rejected(error, `remove artifact ${artifactId}`);
  }
}

/** Command bodies cannot override the identities named by the route. */
async function readInput<T>(
  request: Request,
  schema: { parse(input: unknown): T },
  route: Record<string, string> = {},
) {
  try {
    if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
      return;
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) return;
    if (Object.keys(route).some((key) => key in body)) return;
    return schema.parse({ ...body, ...route });
  } catch {
    return;
  }
}

/** Model choices stay within the member's provider; a null default does not forbid inheritance. */
export async function listChannelMemberModelsResponse(
  channelId: string,
  agentId: string,
): Promise<Response> {
  if (
    !channelIdentitySchema.safeParse({ channelId }).success ||
    !removeChannelMemberInputSchema.safeParse({ agentId }).success
  )
    return invalidRequest();
  try {
    const provider = await getChannelMemberProvider(channelId, agentId);
    if (provider === undefined) return notFound("Channel member");
    return Response.json(
      { version: 1, provider, ...(await getModelChoices(provider ?? undefined)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return rejected(error, `list models for member ${agentId}`);
  }
}

function rejected(error: unknown, action: string): Response {
  if (error instanceof Error && error.message === "Channel not found.") return notFound("Channel");
  if (error instanceof Error && error.message === "Channel member not found.")
    return notFound("Channel member");
  if (error instanceof ChannelInputError)
    return Response.json({ error: error.message }, { status: 422 });
  console.error(`Failed to ${action}:`, error);
  return Response.json({ error: `Unable to ${action}.` }, { status: 500 });
}

function noContent(): Response {
  return new Response(null, { status: 204 });
}

function invalidRequest(): Response {
  return Response.json({ error: "Invalid Channel request." }, { status: 400 });
}

function notFound(noun: string): Response {
  return Response.json({ error: `${noun} not found.` }, { status: 404 });
}
