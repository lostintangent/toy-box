import {
  pushSubscriptionSchema,
  pushRegistrationSchema,
  pushRegistrationIdSchema,
} from "@push/model";
import { getStateDatabase } from "@/server/database";
import { refreshPush } from ".";
import { PushDatabase } from "./database";

const invalidPushRegistration = () =>
  Response.json({ error: "Invalid push registration." }, { status: 400 });

export async function registerResponse(
  registrationID: string,
  request: Request,
): Promise<Response> {
  const input = pushRegistrationSchema.safeParse(await request.json().catch(() => undefined));
  if (!input.success) return invalidPushRegistration();
  return writeResponse(registrationID, async (store) =>
    (await store.register({ registrationID, ...input.data })) ? 201 : 204,
  );
}

export async function subscribeResponse(
  registrationID: string,
  topic: string,
  request: Request,
): Promise<Response> {
  const input = pushSubscriptionSchema.safeParse(await request.json().catch(() => undefined));
  if (!input.success) return invalidPushRegistration();
  return writeResponse(
    registrationID,
    async (store) =>
      (await store.subscribe({ registrationID, ...input.data }, topic)) ? 204 : 404,
    input.data.token === null ? undefined : topic,
  );
}

export function removeResponse(registrationID: string, topic?: string): Promise<Response> {
  return writeResponse(registrationID, async (store) => {
    if (topic === undefined) await store.unregister(registrationID);
    else await store.unsubscribe(registrationID, topic);
    return 204;
  });
}

async function writeResponse(
  registrationID: string,
  write: (store: PushDatabase) => Promise<201 | 204 | 404>,
  topic?: string,
): Promise<Response> {
  if (!pushRegistrationIdSchema.safeParse(registrationID).success) return invalidPushRegistration();
  const status = await write(new PushDatabase(await getStateDatabase()));
  if (status === 404) return Response.json({ error: "Push registration not found." }, { status });
  await refreshPush(topic);
  return new Response(null, { status });
}
