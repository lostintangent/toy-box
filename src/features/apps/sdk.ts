/** Complete compile-time contract for the authored `@toy-box/sdk` module. */

import type { ComponentProps, ReactElement, ReactNode } from "react";
import type { JSONType } from "zod";
import type { WorkspaceFile, WorkspaceFileMode } from "@files/model";
import type { AppInstance, AppShare } from "@apps/model";
import type { Worker } from "@workers/model";
import type {
  SessionCompletion,
  SessionLaunch,
  SessionMessage,
  SessionWorktree,
} from "@sessions/model";
import type { ModelConfiguration } from "@sessions/model/modelConfiguration";

export type {
  AppInstance,
  AppShare,
  ModelConfiguration,
  SessionCompletion,
  SessionLaunch,
  SessionMessage,
  SessionWorktree,
  WorkspaceFile,
  WorkspaceFileMode,
};

/** Creates an opaque browser-safe ID, including on an HTTP LAN origin. */
export function createId(): string {
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(36)).join(
    "-",
  );
}

// Components

export declare function AppShell(props: ComponentProps<"div">): ReactElement;

export declare function AppHeader(props: ComponentProps<"header">): ReactElement;

export declare function AppEmptyState(
  props: ComponentProps<"div"> & {
    title: string;
    description?: string;
    children?: ReactNode;
  },
): ReactElement;

export declare function AppAlert(props: ComponentProps<"div">): ReactElement;

type AppButtonProps = ComponentProps<"button"> & {
  asChild?: boolean;
  variant?:
    | "default"
    | "accent"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost"
    | "link"
    | null;
  size?: "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg" | null;
};

export declare function AppButton(props: AppButtonProps): ReactElement;

export declare function AppSessionToggle(
  props: Omit<AppButtonProps, "asChild" | "aria-pressed" | "onClick" | "type"> & {
    sessionId: string;
  },
): ReactElement;

/**
 * Wraps its children as the hover trigger for a live, read-only preview of a
 * session in a popover. Previewing streams the session passively and never
 * marks it read. Desktop-only; hover is debounced like sidebar previews.
 */
export declare function AppSessionPreview(
  props: ComponentProps<"span"> & {
    sessionId: string;
    disabled?: boolean;
    side?: "top" | "right" | "bottom" | "left";
    align?: "start" | "center" | "end";
  },
): ReactElement;

export declare function AppInput(
  props: ComponentProps<"input"> & { "data-form-type"?: string },
): ReactElement;

export declare function AppTextarea(
  props: ComponentProps<"textarea"> & { "data-form-type"?: string },
): ReactElement;

export declare function AppBadge(
  props: ComponentProps<"span"> & {
    asChild?: boolean;
    variant?: "default" | "secondary" | "destructive" | "outline" | "ghost" | "link" | null;
  },
): ReactElement;

export declare function AppSessionStatus(
  props: Omit<ComponentProps<"span">, "children"> & { status: AppSession["status"] },
): ReactElement;

export declare function AppFilePicker(props: {
  value?: Extract<WorkspaceFile, { type: "machine" }> | null;
  onValueChange: (value: Extract<WorkspaceFile, { type: "machine" }>) => void;
  extensions?: readonly string[];
  className?: string;
}): ReactElement;

export declare function AppModelPicker(props: {
  value: ModelConfiguration;
  onValueChange: (value: ModelConfiguration) => void;
}): ReactElement;

export declare function AppLocationPicker(props: {
  value?: string | null;
  onValueChange: (value: string | null) => void;
  useWorktree?: boolean;
  onUseWorktreeChange?: (value: boolean) => void;
}): ReactElement;

/** Offers MIME-typed content to a compatible saved app from any mounted app. */
export declare function AppSharePicker(props: {
  mimeType: string;
  content: unknown;
  label?: string;
  className?: string;
  disabled?: boolean;
}): ReactElement;

// Hooks

export declare function useWorkspace<T>(selector: (workspace: AppWorkspace) => T): T;

export declare function useFile(file: WorkspaceFile, mode: WorkspaceFileMode): WorkspaceFileState;

/** Host actions available to both saved apps and session-scoped artifact apps. */
export declare function useAppActions(): Omit<
  AppActions,
  "consumeShare" | "spawnWorker" | "cancelWorker"
>;

export type AppHandle<T = JSONType> = Omit<AppInstance, "state"> & {
  state: T;
  shares: AppShare[];
  updateState(updater: AppStateUpdater<T>): Promise<void>;
  actions: AppActions;
};

export declare function useApp(): AppHandle;

export type WorkspaceFileState = {
  /** Last known on-disk content. The mounted surface owns its editing buffer. */
  content: string | null;
  /** External file revision. The surface's own saves do not advance it. */
  revision: number;
  isReady: boolean;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  save(content: string): void;
  flush(options?: { notifyAgent?: boolean }): Promise<void>;
  workers: Array<Pick<Worker, "sessionId" | "name" | "metadata">>;
  spawnWorker?(request: {
    name?: string;
    prompt: string;
    metadata?: JSONType;
  }): Promise<{ sessionId: string }>;
  cancelWorker(workerSessionId: string): Promise<void>;
};

export type AppSession = {
  id: string;
  title: string;
  status: "draft" | "running" | "waiting" | "idle" | "unread";
  /**
   * How the session is governed: an ordinary conversation, a scheduled
   * automation's durable run session, or a member of the Hyper workspace.
   */
  kind: "standard" | "automation" | "hyper";
  directory?: string;
  isRemote: boolean;
  worktree?: SessionWorktree;
  /** Worker sessions owned by this session or one of its files. */
  children: AppSession[];
};

export type AppWorkspace = {
  sessions: AppSession[];
  apps: Array<
    Pick<AppInstance, "id" | "definitionId" | "title" | "revision" | "updatedAt"> & {
      accepts: string[];
    }
  >;
  shares: AppShare[];
  models: Array<{
    id: string;
    name: string;
    supportedReasoningEfforts?: string[];
    defaultReasoningEffort?: string;
  }>;
  defaultModel: ModelConfiguration | null;
  openSessionIds: string[];
  openFiles: WorkspaceFile[];
  workers: Array<Pick<Worker, "sessionId" | "name" | "metadata">>;
};

/** A synchronous, replayable recipe over a private draft of the latest state. */
export type AppStateUpdater<T = JSONType> = (draft: T) => T | void;

// Actions

export type AppActions = {
  consumeShare(shareId: string): Promise<boolean>;
  createSession(input: SessionLaunch & { open?: boolean }): Promise<{ sessionId: string }>;
  spawnWorker(
    input: SessionLaunch & {
      name?: string;
      metadata?: JSONType;
      ephemeral?: boolean;
    },
  ): Promise<{ sessionId: string }>;
  waitForSession(sessionId: string, timeoutMs?: number): Promise<SessionCompletion>;
  cancelWorker(this: void, sessionId: string): Promise<boolean>;
  deleteSession(sessionId: string): Promise<void>;
  deliverMessage(sessionId: string, message: SessionMessage): Promise<void>;
  abortSession(sessionId: string): Promise<void>;
  openSession(sessionId: string): void;
  closeSession(sessionId: string): void;
  toggleSession(sessionId: string): void;
  openFile(file: WorkspaceFile, mode?: WorkspaceFileMode): void;
  closeFile(file: WorkspaceFile): void;
  toggleFile(file: WorkspaceFile, mode?: WorkspaceFileMode): void;
  readFile(file: WorkspaceFile): Promise<string>;
  writeFile(file: WorkspaceFile, content: string): Promise<void>;
};
