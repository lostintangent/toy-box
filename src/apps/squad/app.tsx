import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppEmptyState,
  AppHeader,
  AppLocationPicker,
  AppModelPicker,
  AppSessionStatus,
  AppSessionToggle,
  AppShell,
  AppTextarea,
  useApp,
  useWorkspace,
  type AppActions,
  type AppShare,
  type AppSession,
  type ModelConfiguration,
  type SessionLaunch,
} from "@toy-box/sdk";
import { Bot, Check, Clock, Loader2, MessageSquare, PanelTop, Sparkles } from "lucide-react";

const SQUAD_COMMAND = /^\/?run-squad(?:\s|$)/i;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "The squad operation failed.";
}

type SessionLaunchShare = AppShare & {
  mimeType: "x-session-launch";
  content: SessionLaunch;
};

function isSessionLaunchShare(share: AppShare): share is SessionLaunchShare {
  return share.mimeType === "x-session-launch";
}

async function startSquad(actions: AppActions, launch: SessionLaunch, open = false) {
  const mission = launch.message.content.trim();
  const content = SQUAD_COMMAND.test(mission) ? mission : `/run-squad ${mission}`;
  await actions.createSession({
    ...launch,
    message: { ...launch.message, content },
    open,
  });
}

export function isSquadLeader(session: AppSession): boolean {
  return SQUAD_COMMAND.test(session.title.trim());
}

function descendantCount(session: AppSession): number {
  return session.children.reduce((count, child) => count + 1 + descendantCount(child), 0);
}

function runningDescendantCount(session: AppSession): number {
  return session.children.reduce(
    (count, child) => count + (child.status === "running" ? 1 : 0) + runningDescendantCount(child),
    0,
  );
}

function AgentRow({ session, depth }: { session: AppSession; depth: number }) {
  return (
    <>
      <div
        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-t px-4 py-3 first:border-t-0"
        style={{ paddingLeft: `${16 + depth * 20}px` }}
      >
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Bot aria-hidden="true" className="size-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{session.title}</p>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              {session.worktree ? (
                <span className="truncate font-mono">{session.worktree.branch}</span>
              ) : (
                <span>shared workspace</span>
              )}
              {session.children.length > 0 ? (
                <span>{session.children.length} direct reports</span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <AppSessionStatus status={session.status} />
          <AppSessionToggle
            sessionId={session.id}
            size="icon-sm"
            aria-label={`Toggle ${session.title} pane`}
          >
            <PanelTop aria-hidden="true" className="size-4" />
          </AppSessionToggle>
        </div>
      </div>
      {session.children.map((child) => (
        <AgentRow key={child.id} session={child} depth={depth + 1} />
      ))}
    </>
  );
}

function SquadCard({ leader, actions }: { leader: AppSession; actions: AppActions }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = descendantCount(leader);
  const working = runningDescendantCount(leader);

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    const content = message.trim();
    if (!content || sending) return;

    setSending(true);
    setError(null);
    try {
      await actions.deliverMessage(leader.id, { content });
      setMessage("");
    } catch (cause) {
      setError(describeError(cause));
    }
    setSending(false);
  }

  return (
    <article className="overflow-hidden rounded-2xl border bg-card/70 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4 p-4 @md:p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-indigo-500/12 text-indigo-500">
            <Bot aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate font-semibold">{leader.title}</h2>
              <AppSessionStatus status={leader.status} />
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">
              {leader.directory ?? "No repository selected"}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Bot aria-hidden="true" className="size-3.5" />
                {members} {members === 1 ? "agent" : "agents"}
              </span>
              <span className="flex items-center gap-1.5">
                {working > 0 ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : (
                  <Check aria-hidden="true" className="size-3.5" />
                )}
                {working > 0 ? `${working} working` : "No active assignments"}
              </span>
            </div>
          </div>
        </div>
        <AppSessionToggle sessionId={leader.id}>
          <PanelTop aria-hidden="true" className="size-4" />
          Leader pane
        </AppSessionToggle>
      </div>

      <section className="border-t bg-muted/15">
        <div className="flex items-center justify-between px-4 py-2.5 @md:px-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Agents
          </h3>
          <span className="text-[11px] text-muted-foreground">Live session roster</span>
        </div>
        {leader.children.length > 0 ? (
          <div className="border-t bg-background/70">
            {leader.children.map((child) => (
              <AgentRow key={child.id} session={child} depth={0} />
            ))}
          </div>
        ) : (
          <p className="border-t px-4 py-4 text-sm text-muted-foreground @md:px-5">
            The leader has not delegated an assignment yet.
          </p>
        )}
      </section>

      <form className="border-t p-4 @md:p-5" onSubmit={sendMessage}>
        <div className="mb-2 flex items-center gap-2">
          <MessageSquare aria-hidden="true" className="size-4 text-muted-foreground" />
          <label htmlFor={`message-${leader.id}`} className="text-sm font-medium">
            Message squad leader
          </label>
        </div>
        <div className="grid gap-2 @md:grid-cols-[minmax(0,1fr)_auto]">
          <AppTextarea
            id={`message-${leader.id}`}
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
            placeholder="Approve the result, request a change, or redirect the squad…"
            className="min-h-20 resize-y"
          />
          <AppButton
            type="submit"
            className="self-end"
            disabled={sending || message.trim().length === 0}
          >
            {sending ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <MessageSquare aria-hidden="true" className="size-4" />
            )}
            Send
          </AppButton>
        </div>
        {error ? <AppAlert className="mt-2">{error}</AppAlert> : null}
      </form>
    </article>
  );
}

export default function SquadBoard() {
  const { title, shares, actions } = useApp();
  const sessions = useWorkspace((workspace) => workspace.sessions);
  const defaultModel = useWorkspace((workspace) => workspace.defaultModel);
  const handledShareIds = useRef(new Set<string>());
  const [objective, setObjective] = useState("");
  const [directory, setDirectory] = useState<string | null>(null);
  const [model, setModel] = useState<ModelConfiguration | null>(null);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const activeModel = model ?? defaultModel;
  const squads = sessions.filter(isSquadLeader);
  const activeSquads = squads.filter(
    (session) => session.status === "running" || runningDescendantCount(session) > 0,
  ).length;
  const agentCount = squads.reduce((count, session) => count + descendantCount(session), 0);

  useEffect(() => {
    for (const share of shares) {
      if (!isSessionLaunchShare(share) || handledShareIds.current.has(share.id)) continue;
      handledShareIds.current.add(share.id);
      void (async () => {
        try {
          if (await actions.consumeShare(share.id)) {
            await startSquad(actions, share.content);
          }
        } catch (cause) {
          handledShareIds.current.delete(share.id);
          setError(describeError(cause));
        }
      })();
    }
  }, [actions, shares]);

  async function launchSquad(event: FormEvent) {
    event.preventDefault();
    const mission = objective.trim();
    if (!mission || !directory || !activeModel || launching) return;

    setLaunching(true);
    setError(null);
    try {
      await startSquad(
        actions,
        {
          message: { content: mission, model: activeModel },
          directory,
        },
        true,
      );
      setObjective("");
    } catch (cause) {
      setError(describeError(cause));
    }
    setLaunching(false);
  }

  return (
    <AppShell>
      <AppHeader>
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500">
            <Bot aria-hidden="true" className="size-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold">{title}</h1>
            <p className="truncate text-xs text-muted-foreground">
              Session-native orchestration, live from the workbench
            </p>
          </div>
        </div>
        <div className="hidden items-center gap-2 @md:flex">
          <AppBadge variant="outline">{activeSquads} active</AppBadge>
          <AppBadge variant="outline">{agentCount} agents</AppBadge>
        </div>
      </AppHeader>

      <main className="mx-auto grid w-full max-w-6xl gap-5 p-4 @md:p-6">
        <form
          onSubmit={launchSquad}
          className="rounded-2xl border bg-gradient-to-br from-indigo-500/[0.08] via-background to-background p-4 @md:p-5"
        >
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-500">
              <Sparkles aria-hidden="true" className="size-4" />
            </div>
            <div>
              <h2 className="font-semibold">Launch a squad</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A normal session leads; durable child sessions implement and review in isolation.
              </p>
            </div>
          </div>

          <div className="mt-4 grid gap-4 @3xl:grid-cols-[minmax(0,1fr)_18rem]">
            <div>
              <label htmlFor="squad-objective" className="text-xs font-medium">
                Mission
              </label>
              <AppTextarea
                id="squad-objective"
                value={objective}
                onChange={(event) => setObjective(event.currentTarget.value)}
                placeholder="Describe the outcome, constraints, and evidence of completion."
                className="mt-2 min-h-28 resize-y"
                maxLength={12000}
              />
            </div>
            <div className="grid content-start gap-4">
              <div>
                <p className="mb-2 text-xs font-medium">Repository</p>
                <AppLocationPicker value={directory} onValueChange={setDirectory} />
              </div>
              <div>
                <p className="mb-2 text-xs font-medium">Model</p>
                {activeModel ? (
                  <AppModelPicker value={activeModel} onValueChange={setModel} />
                ) : (
                  <p className="text-xs text-muted-foreground">No model is available.</p>
                )}
              </div>
            </div>
          </div>

          {error ? <AppAlert className="mt-3">{error}</AppAlert> : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock aria-hidden="true" className="size-3.5" />
              The leader and its child sessions keep running when this app closes.
            </p>
            <AppButton
              type="submit"
              disabled={
                launching || objective.trim().length === 0 || !directory || activeModel === null
              }
            >
              {launching ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Sparkles aria-hidden="true" className="size-4" />
              )}
              {launching ? "Launching…" : "Launch squad"}
            </AppButton>
          </div>
        </form>

        <section className="grid gap-3">
          <div className="flex items-center justify-between px-1">
            <div>
              <h2 className="font-semibold">Squads</h2>
              <p className="text-sm text-muted-foreground">
                Leaders and every durable child session, projected live.
              </p>
            </div>
            <AppBadge variant="outline">{squads.length}</AppBadge>
          </div>

          {squads.length > 0 ? (
            <div className="grid gap-4">
              {squads.map((leader) => (
                <SquadCard key={leader.id} leader={leader} actions={actions} />
              ))}
            </div>
          ) : (
            <AppEmptyState
              title="No squads yet"
              description="Launch one here or invoke /run-squad from a standard session."
            />
          )}
        </section>
      </main>
    </AppShell>
  );
}
