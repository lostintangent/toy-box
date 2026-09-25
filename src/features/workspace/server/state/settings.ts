import {
  areSettingsEqual,
  DEFAULT_SETTINGS,
  normalizeSettings,
} from "@workspace/model/config/settings";
import type { Settings } from "@workspace/model/config/settings";
import { getStateDatabase } from "@/server/database";

const SETTINGS_ROW_ID = 1;

type SettingsRow = {
  value: string;
};

/** Durable repository for the workspace's singleton settings document. */
export class SettingsDatabase {
  constructor(private readonly db: Bun.SQL) {}

  async get(): Promise<Settings> {
    const row = await this.#getRow();
    return row ? deserializeSettings(row.value) : DEFAULT_SETTINGS;
  }

  async set(settings: Settings): Promise<boolean> {
    const current = await this.#getRow();
    if (current && areSettingsEqual(deserializeSettings(current.value), settings)) return false;

    const value = JSON.stringify(settings);
    await this.db`
      INSERT INTO settings (id, value)
      VALUES (${SETTINGS_ROW_ID}, ${value})
      ON CONFLICT(id) DO UPDATE SET value = excluded.value
    `;
    return true;
  }

  async #getRow(): Promise<SettingsRow | undefined> {
    const [row] = await this.db<SettingsRow[]>`
      SELECT value FROM settings WHERE id = ${SETTINGS_ROW_ID}
    `;
    return row;
  }
}

export async function getSettings(): Promise<Settings> {
  const database = await getStateDatabase({ createIfMissing: false });
  return database ? new SettingsDatabase(database).get() : DEFAULT_SETTINGS;
}

export async function persistSettings(settings: Settings): Promise<boolean> {
  return new SettingsDatabase(await getStateDatabase()).set(settings);
}

function deserializeSettings(value: string): Settings {
  try {
    return normalizeSettings(JSON.parse(value));
  } catch (error) {
    console.error("Unable to read persisted settings:", error);
    return DEFAULT_SETTINGS;
  }
}
