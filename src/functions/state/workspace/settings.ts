import type { Database } from "db0";
import {
  areSettingsEqual,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from "@/lib/workspace/config/settings";
import type { Settings } from "@/types";
import { getAppDatabase } from "../database";

const SETTINGS_ROW_ID = 1;

type SettingsRow = {
  value: string;
};

/** Durable repository for the workspace's singleton settings document. */
export class SettingsDatabase {
  constructor(private readonly db: Database) {}

  async get(): Promise<Settings> {
    const row = await this.#getRow();
    return row ? deserializeSettings(row.value) : DEFAULT_SETTINGS;
  }

  async set(settings: Settings): Promise<boolean> {
    const current = await this.#getRow();
    if (current && areSettingsEqual(deserializeSettings(current.value), settings)) return false;

    const value = JSON.stringify(settings);
    await this.db.sql`
      INSERT INTO settings (id, value)
      VALUES (${SETTINGS_ROW_ID}, ${value})
      ON CONFLICT(id) DO UPDATE SET value = excluded.value
    `;
    return true;
  }

  async #getRow(): Promise<SettingsRow | undefined> {
    const { rows } = await this.db.sql`SELECT value FROM settings WHERE id = ${SETTINGS_ROW_ID}`;
    return (rows as SettingsRow[])[0];
  }
}

export async function getSettings(): Promise<Settings> {
  const database = await getAppDatabase({ createIfMissing: false });
  return database ? new SettingsDatabase(database).get() : DEFAULT_SETTINGS;
}

export async function persistSettings(settings: Settings): Promise<boolean> {
  return new SettingsDatabase(await getAppDatabase()).set(settings);
}

function deserializeSettings(value: string): Settings {
  try {
    return normalizeSettings(JSON.parse(value));
  } catch (error) {
    console.error("Unable to read persisted settings:", error);
    return DEFAULT_SETTINGS;
  }
}
