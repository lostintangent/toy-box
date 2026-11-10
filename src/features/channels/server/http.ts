import type { z } from "zod";
import { ChannelInputError } from "./database";

/** Command bodies are JSON objects that cannot override the identities their route names. */
export async function readInput<T>(
  request: Request,
  schema: z.ZodType<T>,
  route: Record<string, string> = {},
): Promise<T> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const body: unknown = type === "application/json" ? await request.json().catch(() => null) : null;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidRequest();
  if (Object.keys(route).some((key) => key in body)) throw invalidRequest();
  const input = schema.safeParse({ ...body, ...route });
  if (!input.success) throw invalidRequest();
  return input.data;
}

/** Domain failures keep their meaning on the wire; anything else is logged as the action's failure.
 *  A thrown Response, such as an invalid request, is the answer itself. */
export async function respond(action: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof ChannelInputError)
      return Response.json({ error: error.message }, { status: 422 });
    if (error instanceof Error && error.message === "Channel not found.")
      return notFound("Channel");
    // Only posts carry client-chosen IDs, so a duplicate key is always a taken message ID.
    if (error instanceof Error && "code" in error && error.code === "SQLITE_CONSTRAINT_PRIMARYKEY")
      return Response.json({ error: "Message ID already exists." }, { status: 409 });
    console.error(`Failed to ${action}:`, error);
    return Response.json({ error: `Unable to ${action}.` }, { status: 500 });
  }
}

export function noContent(): Response {
  return new Response(null, { status: 204 });
}

export function invalidRequest(): Response {
  return Response.json({ error: "Invalid Channel request." }, { status: 400 });
}

export function notFound(noun: string): Response {
  return Response.json({ error: `${noun} not found.` }, { status: 404 });
}
