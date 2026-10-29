import type { PushEnvironment, NotificationEvent, UpdateEvent } from "@push/model";

export type APNsMessage = {
  token: string;
  environment: PushEnvironment;
  pushType: "alert" | "liveactivity";
  priority: 5 | 10;
  expiration: number;
  collapseID?: string;
  payload: object;
};
export type APNsResult = { status: number; reason?: string };
export interface PushSender {
  send(message: APNsMessage): Promise<APNsResult>;
}
export const defaultPushRelayURL = "https://toy-box-push-relay.lostintangent.workers.dev";
const apnsPayloadLimit = 4096;

export class RelaySender implements PushSender {
  constructor(private readonly url = process.env.TOY_BOX_PUSH_RELAY_URL ?? defaultPushRelayURL) {}

  async send(message: APNsMessage): Promise<APNsResult> {
    const response = await fetch(
      `${this.url.replace(/\/$/, "")}/${message.environment}/3/device/${message.token}`,
      {
        method: "POST",
        headers: {
          "apns-push-type": message.pushType,
          "apns-priority": String(message.priority),
          "apns-expiration": String(Math.floor(message.expiration)),
          ...(message.collapseID === undefined ? {} : { "apns-collapse-id": message.collapseID }),
        },
        body: JSON.stringify(message.payload),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      },
    );
    const status = response.status;
    if (status === 200) return { status };
    const { reason } = (await response.json().catch(() => ({}))) as { reason?: unknown };
    return typeof reason === "string" ? { status, reason } : { status };
  }
}

export function notificationPayload(event: NotificationEvent, registrationID: string) {
  const payload = {
    ...event.data,
    registrationID,
    aps: {
      alert: { title: event.title, body: event.body },
      sound: "default",
      category: event.category,
      "mutable-content": 1,
      ...(event.threadID === undefined
        ? {}
        : { "thread-id": `${registrationID}:${event.threadID}` }),
    },
  };
  if (Buffer.byteLength(JSON.stringify(payload)) > apnsPayloadLimit) {
    let prefix = "";
    for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      event.body,
    )) {
      payload.aps.alert.body = prefix + segment + "\u2026";
      if (Buffer.byteLength(JSON.stringify(payload)) > apnsPayloadLimit) break;
      prefix += segment;
    }
    payload.aps.alert.body = prefix.trimEnd() + "\u2026";
    if (Buffer.byteLength(JSON.stringify(payload)) > apnsPayloadLimit)
      throw new Error("Notification routing and title exceed APNs' 4096-byte limit.");
  }
  return payload;
}

export function updatePayload(event: UpdateEvent, timestamp: number) {
  const wrap = (content: object) => ({
    aps: {
      timestamp,
      event: event.ending ? "end" : "update",
      ...(event.ending
        ? { "dismissal-date": timestamp + (event.dismissImmediately ? 0 : 900) }
        : { "stale-date": timestamp + 900 }),
      "content-state": content,
    },
  });
  const overhead = Buffer.byteLength(JSON.stringify(wrap({}))) - 2;
  const content = event.render(timestamp, apnsPayloadLimit - overhead);
  if (!content) return;
  const payload = wrap(content);
  if (Buffer.byteLength(JSON.stringify(payload)) > apnsPayloadLimit)
    throw new Error("Push content exceeds APNs' 4096-byte limit.");
  return payload;
}
