import type { AnyRoute } from "@tanstack/react-router";
import { createTestDatabase, setStateDatabase } from "./database";

let testDatabase: Bun.SQL | undefined;

/** A fresh state database that the code under test reads until the next test opens its own. It
 *  stays open through the test's cleanup and any work outliving it, so neither reaches the real
 *  database. */
export async function openTestDatabase(): Promise<Bun.SQL> {
  await testDatabase?.close();
  testDatabase = await createTestDatabase();
  setStateDatabase(testDatabase);
  return testDatabase;
}

/** Calls a file route's server handler for the request's method, as the server would. */
export async function invokeRoute(
  route: AnyRoute,
  request: Request,
  params: Record<string, string> = {},
): Promise<Response> {
  const handlers = route.options.server?.handlers;
  const handler = typeof handlers === "function" ? undefined : handlers?.[request.method];
  if (typeof handler !== "function") throw new Error(`The route must handle ${request.method}.`);
  const response = await handler({
    request,
    params,
    pathname: new URL(request.url).pathname,
    context: undefined,
    next: () => {
      throw new Error("The route must answer the request itself.");
    },
  });
  if (!(response instanceof Response)) throw new Error("The route must return a Response.");
  return response;
}
