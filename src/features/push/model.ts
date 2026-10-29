import { z } from "zod";

export const pushRegistrationIdSchema = z.uuid();
export const pushRegistrationSchema = z
  .object({
    token: z.string().regex(/^(?:[0-9a-f]{2}){1,512}$/i),
    environment: z.enum(["sandbox", "production"]),
  })
  .strict();
export const pushSubscriptionSchema = z.union([
  z.object({ token: z.null().default(null), startedAt: z.null().default(null) }).strict(),
  z
    .object({
      token: pushRegistrationSchema.shape.token,
      startedAt: z.number().finite().nonnegative(),
    })
    .strict(),
]);
export type PushRegistration = z.output<typeof pushRegistrationSchema> & {
  registrationID: string;
};
export type PushSubscription = z.output<typeof pushSubscriptionSchema> & {
  registrationID: string;
};
export type PushEnvironment = PushRegistration["environment"];
export type TopicSubscription = PushRegistration & {
  topic: string;
} & ({ pushType: "alert"; startedAt: null } | { pushType: "liveactivity"; startedAt: number });

export type NotificationEvent = {
  type: "notification";
  /** APNs collapse identity, at most 64 UTF-8 bytes. */
  key: string;
  title: string;
  body: string;
  category: string;
  threadID?: string;
  data: Record<string, unknown>;
};
export type UpdateEvent = {
  type: "update";
  value: object;
  attention?: string | number;
  ending: boolean;
  dismissImmediately?: boolean;
  render(timestamp: number, byteLimit: number): object | undefined;
};
export type PushEvent = NotificationEvent | UpdateEvent;
export type PushPublication = PushEvent | (() => Promise<PushEvent | undefined>);
