// SQLite-backed state for saved app instances.

import type { JSONType } from "zod";
import type { AppInstance, AppShare, AppUpdate, AppUpdateResult } from "@apps/model";

const APP_ID_PREFIX = "toy-box-app-";

/** Durable repository for saved app instances, independent of their TSX definitions. */
export class AppDatabase {
  constructor(private readonly db: Bun.SQL) {}

  async list(): Promise<AppInstance[]> {
    const rows = await this.db<AppRow[]>`
      SELECT * FROM apps ORDER BY title COLLATE NOCASE, id
    `;
    return rows.map(appFromRow);
  }

  async get(appId: string): Promise<AppInstance | null> {
    const [row] = await this.db<AppRow[]>`SELECT * FROM apps WHERE id = ${appId}`;
    return row ? appFromRow(row) : null;
  }

  async listShares(): Promise<AppShare[]> {
    const rows = await this.db<AppShareRow[]>`
      SELECT * FROM app_shares ORDER BY created_at, id
    `;
    return rows.map(appShareFromRow);
  }

  async hasInstancesForDefinition(definitionId: string): Promise<boolean> {
    const rows = await this.db<{ present: number }[]>`
      SELECT 1 AS present FROM apps WHERE definition_id = ${definitionId} LIMIT 1
    `;
    return rows.length > 0;
  }

  async create(
    input: Pick<AppInstance, "definitionId" | "title" | "color" | "state">,
  ): Promise<AppInstance> {
    const timestamp = new Date().toISOString();
    const app: AppInstance = {
      id: `${APP_ID_PREFIX}${crypto.randomUUID()}`,
      definitionId: input.definitionId,
      title: input.title,
      color: input.color,
      state: input.state,
      revision: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    await this.db`
      INSERT INTO apps (id, definition_id, title, color, state, revision, created_at, updated_at)
      VALUES (
        ${app.id},
        ${app.definitionId},
        ${app.title},
        ${app.color},
        ${JSON.stringify(app.state)},
        ${app.revision},
        ${app.createdAt},
        ${app.updatedAt}
      )
    `;

    return app;
  }

  async createShare(
    input: Pick<AppShare, "sourceAppId" | "targetAppId" | "mimeType" | "content">,
  ): Promise<AppShare> {
    const share: AppShare = {
      id: `toy-box-app-share-${crypto.randomUUID()}`,
      ...input,
      createdAt: new Date().toISOString(),
    };

    await this.db`
      INSERT INTO app_shares (id, source_app_id, target_app_id, mime_type, content, created_at)
      VALUES (
        ${share.id},
        ${share.sourceAppId},
        ${share.targetAppId},
        ${share.mimeType},
        ${JSON.stringify(share.content)},
        ${share.createdAt}
      )
    `;

    return share;
  }

  async update(appId: string, input: AppUpdate): Promise<AppUpdateResult | null> {
    const updatedAt = new Date().toISOString();
    const [row] = await this.db<AppRow[]>`
      UPDATE apps
      SET
        title = COALESCE(${input.title ?? null}, title),
        color = COALESCE(${input.color ?? null}, color),
        state = COALESCE(${input.state === undefined ? null : JSON.stringify(input.state)}, state),
        revision = revision + 1,
        updated_at = ${updatedAt}
      WHERE id = ${appId} AND revision = ${input.expectedRevision}
      RETURNING *
    `;

    if (row) return { status: "updated", app: appFromRow(row) };

    const latest = await this.get(appId);
    return latest ? { status: "conflict", app: latest } : null;
  }

  async delete(appId: string): Promise<boolean> {
    const rows = await this.db<{ id: string }[]>`
      DELETE FROM apps WHERE id = ${appId} RETURNING id
    `;
    return rows.length > 0;
  }

  async deleteShare(targetAppId: string, shareId: string): Promise<boolean> {
    const rows = await this.db<{ id: string }[]>`
      DELETE FROM app_shares
      WHERE id = ${shareId} AND target_app_id = ${targetAppId}
      RETURNING id
    `;
    return rows.length > 0;
  }
}

type AppRow = {
  id: string;
  definition_id: string;
  title: string;
  color: AppInstance["color"];
  state: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

type AppShareRow = {
  id: string;
  source_app_id: string;
  target_app_id: string;
  mime_type: string;
  content: string;
  created_at: string;
};

function appFromRow(row: AppRow): AppInstance {
  return {
    id: row.id,
    definitionId: row.definition_id,
    title: row.title,
    color: row.color,
    state: JSON.parse(row.state) as JSONType,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function appShareFromRow(row: AppShareRow): AppShare {
  return {
    id: row.id,
    sourceAppId: row.source_app_id,
    targetAppId: row.target_app_id,
    mimeType: row.mime_type,
    content: JSON.parse(row.content) as JSONType,
    createdAt: row.created_at,
  };
}
