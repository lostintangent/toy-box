import type {
  NotificationEvent,
  PushPublication,
  TopicSubscription,
  UpdateEvent,
} from "@push/model";
import { getStateDatabase } from "@/server/database";
import { getProcessValue } from "@/shared/server/processState";
import { SerialTaskQueue } from "@/shared/serialTaskQueue";
import {
  RelaySender,
  notificationPayload,
  updatePayload,
  type PushSender,
  type APNsMessage,
} from "./apns";
import { PushDatabase } from "./database";

type Topic = {
  subscriptions: TopicSubscription[];
  update?: UpdateEvent;
  sent?: { value: string; at: number; attention: UpdateEvent["attention"] };
};
type TopicListener = (topic: string, active: boolean) => void;
type BadgeSource = { topics: readonly string[]; count: () => Promise<number | undefined> };
const runtime = getProcessValue<{
  service?: PushService;
  listeners: Set<TopicListener>;
  badge?: BadgeSource;
}>("push.runtime", () => ({ listeners: new Set() }));
export function publish(topic: string, event: PushPublication): Promise<void> | undefined {
  return runtime.service?.publish(topic, event);
}
export function publishBadge(
  topics: readonly string[],
  count: () => Promise<number | undefined>,
): Promise<void> | undefined {
  runtime.badge = { topics, count };
  return runtime.service?.publishBadge(topics, count);
}
export function observeTopics(listener: TopicListener): VoidFunction {
  runtime.listeners.add(listener);
  for (const topic of runtime.service?.topics.keys() ?? []) listener(topic, true);
  return () => {
    runtime.listeners.delete(listener);
  };
}
export async function refreshPush(topic?: string): Promise<void> {
  await runtime.service?.load(topic);
}

export class PushService {
  readonly topics = new Map<string, Topic>();
  private readonly queue = new SerialTaskQueue();
  private readonly store: PushDatabase;
  private readonly interval: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private badge?: BadgeSource;
  private readonly badgeSent = new Map<string, number>();

  constructor(
    db: Bun.SQL,
    private readonly sender: PushSender,
    private readonly interest: TopicListener = (topic, active) => {
      for (const listener of runtime.listeners) listener(topic, active);
    },
    private readonly now: () => number = () => Date.now() / 1000,
  ) {
    this.store = new PushDatabase(db);
    this.interval = setInterval(
      () => this.tick().catch((error) => console.error("Push refresh failed:", error)),
      300_000,
    );
    this.interval.unref();
  }

  load(catchupTopic?: string): Promise<void> {
    return this.queue.enqueue(async () => {
      await this.reload();
      await this.badges();
      const current = catchupTopic === undefined ? undefined : this.topics.get(catchupTopic);
      if (current) {
        delete current.sent;
        this.scheduleFlush();
      }
    });
  }

  publish(topic: string, publication: PushPublication): Promise<void> | undefined {
    if (this.stopped || !this.topics.has(topic)) return;
    const createdAt = this.now();
    return (async () => {
      const event = typeof publication === "function" ? await publication() : publication;
      if (!event) return;
      if (event.type === "update") {
        const current = this.topics.get(topic);
        if (current) {
          current.update = event;
          this.scheduleFlush();
        }
      } else await this.queue.enqueue(() => this.notify(topic, event, createdAt));
    })().catch((error) => console.error("Push publication failed:", error));
  }

  publishBadge(
    topics: readonly string[],
    count: () => Promise<number | undefined>,
  ): Promise<void> | undefined {
    if (this.stopped) return;
    this.badge = { topics, count };
    return this.queue
      .enqueue(() => this.badges())
      .catch((error) => console.error("Badge publication failed:", error));
  }

  flush(): Promise<void> {
    clearTimeout(this.debounce);
    delete this.debounce;
    return this.queue.enqueue(() => this.updates());
  }

  tick(): Promise<void> {
    return this.queue.enqueue(async () => {
      await this.reload();
      await this.badges();
      await this.updates();
    });
  }

  stop(): void {
    this.stopped = true;
    clearInterval(this.interval);
    clearTimeout(this.debounce);
    for (const topic of this.topics.keys()) this.interest(topic, false);
    this.topics.clear();
    this.badgeSent.clear();
    delete this.badge;
  }

  private async reload(): Promise<void> {
    if (this.stopped) return;
    await this.store.expire(this.now() - 8 * 3600);
    const subscriptions = await this.store.subscriptions();
    if (this.stopped) return;
    const grouped = new Map<string, TopicSubscription[]>();
    for (const subscription of subscriptions) {
      const values = grouped.get(subscription.topic) ?? [];
      values.push(subscription);
      grouped.set(subscription.topic, values);
    }
    for (const topic of this.topics.keys())
      if (!grouped.has(topic)) {
        this.topics.delete(topic);
        this.interest(topic, false);
      }
    for (const [topic, subscriptions] of grouped) {
      const current = this.topics.get(topic);
      if (current) current.subscriptions = subscriptions;
      else {
        this.topics.set(topic, { subscriptions });
        this.interest(topic, true);
      }
    }
    const active = new Set(this.badgeSubscriptions().keys());
    for (const key of this.badgeSent.keys()) if (!active.has(key)) this.badgeSent.delete(key);
  }

  private async notify(topic: string, event: NotificationEvent, createdAt: number): Promise<void> {
    if (this.stopped) return;
    for (const subscription of await this.store.subscriptions()) {
      if (this.stopped) return;
      if (subscription.topic !== topic || subscription.pushType !== "alert") continue;
      await this.send({
        token: subscription.token,
        environment: subscription.environment,
        pushType: "alert",
        priority: 10,
        expiration: createdAt + 900,
        collapseID: event.key,
        payload: notificationPayload(event, subscription.registrationID),
      });
    }
  }

  private badgeKey(subscription: TopicSubscription): string {
    return `${subscription.registrationID}:${subscription.environment}:${subscription.token}`;
  }

  private badgeSubscriptions(
    subscriptions = [...this.topics.values()].flatMap((topic) => topic.subscriptions),
  ): Map<string, TopicSubscription> {
    return new Map(
      subscriptions
        .filter(
          (subscription) =>
            subscription.pushType === "alert" && this.badge?.topics.includes(subscription.topic),
        )
        .map((subscription) => [this.badgeKey(subscription), subscription]),
    );
  }

  private async badgeCount(): Promise<number | undefined> {
    const count = await this.badge?.count();
    if (count !== undefined && (!Number.isSafeInteger(count) || count < 0))
      throw new Error("An app badge must be a nonnegative integer.");
    return count;
  }

  private async badges(): Promise<void> {
    if (this.stopped || !this.badgeSubscriptions().size) return;
    const badge = await this.badgeCount();
    if (badge === undefined || this.stopped) return;
    for (const [key, subscription] of this.badgeSubscriptions(await this.store.subscriptions())) {
      if (this.stopped) return;
      if (this.badgeSent.get(key) === badge) continue;
      const sent = await this.send({
        token: subscription.token,
        environment: subscription.environment,
        pushType: "alert",
        priority: 10,
        expiration: this.now() + 900,
        collapseID: "badge",
        payload: { aps: { badge } },
      });
      if (this.stopped) return;
      if (sent) this.badgeSent.set(key, badge);
    }
  }

  private async updates(): Promise<void> {
    let ended = false;
    for (const [topic, current] of this.topics) {
      const event = current.update,
        previous = current.sent;
      if (!event) continue;
      const value = JSON.stringify(event.value);
      if (
        !event.ending &&
        previous?.value === value &&
        previous.attention === event.attention &&
        this.now() < previous.at + 300
      )
        continue;
      const payload = updatePayload(event, this.now());
      if (!payload) continue;
      const priority =
        event.ending || (event.attention !== undefined && event.attention !== previous?.attention)
          ? 10
          : 5;
      let delivered = false;
      for (const subscription of current.subscriptions) {
        if (subscription.pushType !== "liveactivity") continue;
        const sent = await this.send({
          token: subscription.token,
          environment: subscription.environment,
          pushType: "liveactivity",
          priority,
          expiration: this.now() + 900,
          payload,
        });
        if (sent && event.ending) {
          await this.store.unsubscribe(subscription.registrationID, topic, subscription.token);
          ended = true;
        }
        delivered ||= sent;
      }
      if (delivered && !event.ending)
        current.sent = { value, at: this.now(), attention: event.attention };
    }
    if (ended) await this.reload();
  }

  private async send(message: APNsMessage): Promise<boolean> {
    try {
      const { status, reason } = await this.sender.send(message);
      if (status === 200) return true;
      console.error("APNs rejected push:", status, reason);
      if (status === 410 || (status === 400 && reason === "BadDeviceToken")) {
        await this.store.pruneToken(message);
        await this.reload();
      }
    } catch (error) {
      console.error("Failed to deliver push:", error);
    }
    return false;
  }

  private scheduleFlush(): void {
    if (this.debounce) return;
    this.debounce = setTimeout(
      () => this.flush().catch((error) => console.error("Push update failed:", error)),
      100,
    );
    this.debounce.unref();
  }
}

export async function startPush(): Promise<VoidFunction> {
  runtime.service?.stop();
  const service = new PushService(await getStateDatabase(), new RelaySender());
  runtime.service = service;
  if (runtime.badge) await service.publishBadge(runtime.badge.topics, runtime.badge.count);
  await service.load();
  return () => {
    service.stop();
    if (runtime.service === service) delete runtime.service;
  };
}
