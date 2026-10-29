import type { TopicSubscription, PushSubscription, PushRegistration } from "@push/model";
import { inStateTransaction } from "@/server/database";

export class PushDatabase {
  constructor(private readonly db: Bun.SQL) {}

  async register(input: PushRegistration): Promise<boolean> {
    return inStateTransaction(this.db, async (db) => {
      const existing =
        await db`SELECT registration_id FROM push_registrations WHERE registration_id = ${input.registrationID}`;
      await db`DELETE FROM push_registrations
        WHERE token = ${input.token} AND environment = ${input.environment}
          AND registration_id <> ${input.registrationID}`;
      await db`
        INSERT INTO push_registrations ${db({
          registration_id: input.registrationID,
          token: input.token,
          environment: input.environment,
        })}
        ON CONFLICT(registration_id) DO UPDATE SET
          token = excluded.token, environment = excluded.environment
      `;
      return existing.length === 0;
    });
  }

  async unregister(registrationID: string): Promise<void> {
    await this.db`DELETE FROM push_registrations WHERE registration_id = ${registrationID}`;
  }

  async expire(startedBefore: number): Promise<void> {
    await this.db`DELETE FROM push_subscriptions WHERE started_at <= ${startedBefore}`;
  }

  async subscribe(input: PushSubscription, topic: string): Promise<boolean> {
    const rows = await this.db`
      INSERT INTO push_subscriptions (registration_id, topic, token, started_at)
      SELECT ${input.registrationID}, ${topic}, ${input.token}, ${input.startedAt}
      WHERE EXISTS (SELECT 1 FROM push_registrations WHERE registration_id = ${input.registrationID})
      ON CONFLICT(registration_id, topic) DO UPDATE SET
        token = excluded.token, started_at = excluded.started_at
      RETURNING registration_id
    `;
    return rows.length > 0;
  }

  subscriptions(): Promise<TopicSubscription[]> {
    return this.db<TopicSubscription[]>`
      SELECT s.registration_id AS registrationID, s.topic,
        COALESCE(s.token, r.token) AS token, r.environment, s.started_at AS startedAt,
        CASE WHEN s.token IS NULL THEN 'alert' ELSE 'liveactivity' END AS pushType
      FROM push_subscriptions s JOIN push_registrations r USING (registration_id)
      ORDER BY s.registration_id, s.topic
    `;
  }

  async unsubscribe(registrationID: string, topic: string, token?: string): Promise<void> {
    await this.db`DELETE FROM push_subscriptions
      WHERE registration_id = ${registrationID} AND topic = ${topic}
        AND (${token === undefined} OR token = ${token ?? null})`;
  }

  async pruneToken(message: Pick<PushRegistration, "token" | "environment">): Promise<void> {
    await inStateTransaction(this.db, async (db) => {
      await db`DELETE FROM push_subscriptions WHERE token = ${message.token}
        AND registration_id IN (SELECT registration_id FROM push_registrations
          WHERE environment = ${message.environment})`;
      await db`DELETE FROM push_registrations
        WHERE token = ${message.token} AND environment = ${message.environment}`;
    });
  }
}
