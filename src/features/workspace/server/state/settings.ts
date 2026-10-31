import { DEFAULT_SETTINGS, normalizeSettings } from "@workspace/model/config/settings";
import type { Settings } from "@workspace/model/config/settings";
import { getStateDatabase } from "@/server/database";

// Settings are one document in a singleton row.
const SETTINGS_ROW_ID = 1;

export async function getSettings(): Promise<Settings> {
  const db = await getStateDatabase({ createIfMissing: false });
  if (!db) return DEFAULT_SETTINGS;

  const [row] = await db<{ value: string }[]>`
    SELECT value FROM settings WHERE id = ${SETTINGS_ROW_ID}
  `;
  return row ? deserializeSettings(row.value) : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await getStateDatabase();
  await db`
    INSERT INTO settings (id, value)
    VALUES (${SETTINGS_ROW_ID}, ${JSON.stringify(settings)})
    ON CONFLICT(id) DO UPDATE SET value = excluded.value
  `;
}

function deserializeSettings(value: string): Settings {
  try {
    return normalizeSettings(JSON.parse(value));
  } catch (error) {
    console.error("Unable to read persisted settings:", error);
    return DEFAULT_SETTINGS;
  }
}
