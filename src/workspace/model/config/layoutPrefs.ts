import { z } from "zod";

// One sparse cookie lets SSR and the hydrated shell begin with the same
// browser-local workspace layout. Omitted values take their product defaults.

const LAYOUT_COOKIE = "toybox_layout";
const LAYOUT_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const DEFAULT_SIDEBAR_WIDTH = 280;
const DEFAULT_TERMINAL_SIZE = 30;
const DEFAULT_HYPER_POSITION = { x: 24, y: 24 };

// The sidebar is sized in pixels so the workspace panes can keep dividing
// whatever is left as percentages, and so its width survives window resizes.
export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 480;

const TERMINAL_MIN_SIZE = 15;
const TERMINAL_MAX_SIZE = 80;

export function clampSidebarWidth(value: number): number {
  return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, value));
}

function clampTerminalSize(value: number): number {
  return Math.min(TERMINAL_MAX_SIZE, Math.max(TERMINAL_MIN_SIZE, value));
}

const sidebarPanelsSchema = z.object({
  channels: z.literal(true).optional(),
  apps: z.literal(true).optional(),
  automations: z.literal(true).optional(),
});

export type SidebarPanels = z.infer<typeof sidebarPanelsSchema>;

const workspaceLayoutSchema = z.object({
  sidebarWidth: z.number().finite().transform(clampSidebarWidth).default(DEFAULT_SIDEBAR_WIDTH),
  terminalSize: z.number().finite().transform(clampTerminalSize).default(DEFAULT_TERMINAL_SIZE),
  sidebarCollapsed: z.boolean().default(false),
  terminalOpen: z.boolean().default(false),
  panels: sidebarPanelsSchema.default({}),
  hyperOpen: z.boolean().default(false),
  hyperPosition: z
    .object({ x: z.number().finite(), y: z.number().finite() })
    .default(DEFAULT_HYPER_POSITION),
});

export type WorkspaceLayout = z.output<typeof workspaceLayoutSchema>;

const DEFAULT_WORKSPACE_LAYOUT = workspaceLayoutSchema.parse({});

function readLayoutCookie(cookieHeader?: string | null): string | undefined {
  const prefix = `${LAYOUT_COOKIE}=`;
  return cookieHeader
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

export function readWorkspaceLayout(cookieHeader?: string | null): WorkspaceLayout {
  const cookie = readLayoutCookie(cookieHeader);
  if (!cookie) return DEFAULT_WORKSPACE_LAYOUT;

  try {
    const parsed = workspaceLayoutSchema.safeParse(JSON.parse(decodeURIComponent(cookie)));
    return parsed.success ? parsed.data : DEFAULT_WORKSPACE_LAYOUT;
  } catch {
    return DEFAULT_WORKSPACE_LAYOUT;
  }
}

export function serializeWorkspaceLayout(layout: WorkspaceLayout): string {
  const panels = {
    ...(layout.panels.channels ? { channels: true } : {}),
    ...(layout.panels.apps ? { apps: true } : {}),
    ...(layout.panels.automations ? { automations: true } : {}),
  };
  const hasExpandedPanel = panels.channels || panels.apps || panels.automations;

  const stored = {
    ...(layout.sidebarWidth !== DEFAULT_SIDEBAR_WIDTH ? { sidebarWidth: layout.sidebarWidth } : {}),
    ...(layout.terminalSize !== DEFAULT_TERMINAL_SIZE ? { terminalSize: layout.terminalSize } : {}),
    ...(layout.sidebarCollapsed ? { sidebarCollapsed: true } : {}),
    ...(layout.terminalOpen ? { terminalOpen: true } : {}),
    ...(hasExpandedPanel ? { panels } : {}),
    ...(layout.hyperOpen ? { hyperOpen: true } : {}),
    ...(layout.hyperPosition.x !== DEFAULT_HYPER_POSITION.x ||
    layout.hyperPosition.y !== DEFAULT_HYPER_POSITION.y
      ? { hyperPosition: layout.hyperPosition }
      : {}),
  };

  return `${LAYOUT_COOKIE}=${encodeURIComponent(JSON.stringify(stored))}; Path=/; Max-Age=${LAYOUT_COOKIE_MAX_AGE}; SameSite=Lax`;
}
