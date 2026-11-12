// How every `/api/v1` route answers: values as uncached JSON, refusals in the caller's words,
// and unexpected failures as a logged, generic 500.

import type { ServerRequest } from "nitro/types";
import type { z } from "zod";

/** A request the server declines for a reason its caller can show. Answers 422. */
export class RefusalError extends Error {}

/** A request naming something that doesn't exist. Answers 404. */
export class NotFoundError extends RefusalError {
  constructor(noun: string) {
    super(`${noun} not found.`);
  }
}

/** Answers a request with what `run` returns: a value as uncached JSON, nothing as 204, and a
 *  Response as itself. A thrown Response, such as an invalid request, is the answer itself, a
 *  refusal keeps its words, and anything else is logged as the action's failure. */
export async function respond(action: string, run: () => unknown): Promise<Response> {
  try {
    const value = await run();
    if (value instanceof Response) return value;
    if (value === undefined) return new Response(null, { status: 204 });
    return Response.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof RefusalError) {
      const status = error instanceof NotFoundError ? 404 : 422;
      return Response.json({ error: error.message }, { status });
    }
    console.error(`Failed to ${action}:`, error);
    return Response.json({ error: `Unable to ${action}.` }, { status: 500 });
  }
}

/** Command bodies are JSON objects that cannot override the identities their route names. */
export async function readInput<T>(
  request: Request,
  schema: z.ZodType<T>,
  route: Record<string, string> = {},
): Promise<T> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const body: unknown = type === "application/json" ? await request.json().catch(() => null) : null;
  if (!body || typeof body !== "object" || Array.isArray(body)) throw invalidRequest();
  if (Object.keys(route).some((key) => key in body)) throw invalidRequest();
  const input = schema.safeParse({ ...body, ...route });
  if (!input.success) throw invalidRequest();
  return input.data;
}

export function invalidRequest(): Response {
  return Response.json({ error: "Invalid request." }, { status: 400 });
}

/** Lets a request outlast Bun's idle timeout, for answers that wait on installs or cold starts. */
export function disableIdleTimeout(request: Request) {
  (request as ServerRequest).runtime?.bun?.server.timeout(request, 0);
}
