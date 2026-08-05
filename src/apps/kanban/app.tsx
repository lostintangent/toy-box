import { useRef, useState } from "react";
import {
  AppAlert,
  AppBadge,
  AppButton,
  AppEmptyState,
  AppHeader,
  AppInput,
  AppLocationPicker,
  AppModelPicker,
  AppSharePicker,
  AppShell,
  AppSessionStatus,
  AppSessionToggle,
  AppTextarea,
  createId,
  useApp,
  useWorkspace,
  type SessionLaunch,
} from "@toy-box/sdk";
import {
  ArrowLeft,
  ArrowRight,
  GripVertical,
  Kanban,
  Loader2,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

type KanbanState = ReturnType<typeof useApp>["state"];
type KanbanColumn = KanbanState["columns"][number];
type KanbanCard = KanbanState["cards"][number];

type CardForm = {
  title: string;
  prompt: string;
  model: NonNullable<KanbanCard["model"]> | null;
  directory: string | null;
  useWorktree: boolean;
};

type CardEditorState =
  | { type: "create"; columnId: string; form: CardForm }
  | { type: "edit"; cardId: string; form: CardForm };

function sessionLaunchForCard(card: KanbanCard): SessionLaunch {
  const prompt = card.prompt.trim();
  return {
    message: {
      content: prompt ? `${card.title}\n\n${prompt}` : card.title,
      ...(card.model ? { model: card.model } : {}),
    },
    ...(card.directory ? { directory: card.directory } : {}),
    ...(card.directory && card.useWorktree ? { useWorktree: true } : {}),
  };
}

function hasSameSessionLaunch(left: KanbanCard, right: KanbanCard): boolean {
  return JSON.stringify(sessionLaunchForCard(left)) === JSON.stringify(sessionLaunchForCard(right));
}

function describeError(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function KanbanBoard() {
  const { title: appTitle, state, updateState, actions } = useApp();
  const sessions = useWorkspace((workspace) => workspace.sessions);
  const models = useWorkspace((workspace) => workspace.models);
  const defaultModel = useWorkspace((workspace) => workspace.defaultModel);
  const [cardEditor, setCardEditor] = useState<CardEditorState | null>(null);
  const [newColumnTitle, setNewColumnTitle] = useState<string | null>(null);
  const [busyCardIds, setBusyCardIds] = useState(() => new Set<string>());
  const [deletingCardId, setDeletingCardId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const boardRef = useRef<HTMLElement>(null);
  const draggingCardIdRef = useRef<string | null>(null);

  function updateCardForm(patch: Partial<CardForm>) {
    setCardEditor((current) =>
      current ? { ...current, form: { ...current.form, ...patch } } : current,
    );
  }

  async function runCardAction(cardId: string, fallback: string, action: () => Promise<void>) {
    setBusyCardIds((current) => new Set(current).add(cardId));
    setError(null);
    try {
      await action();
    } catch (error) {
      setError(describeError(error, fallback));
    }
    setBusyCardIds((current) => {
      const next = new Set(current);
      next.delete(cardId);
      return next;
    });
  }

  async function updateBoard(update: (draft: KanbanState) => void): Promise<boolean> {
    setError(null);
    try {
      await updateState(update);
      return true;
    } catch (error) {
      setError(describeError(error, "Unable to save the board."));
      return false;
    }
  }

  function openNewCard(columnId: string) {
    setCardEditor({
      type: "create",
      columnId,
      form: {
        title: "",
        prompt: "",
        model: defaultModel,
        directory: null,
        useWorktree: false,
      },
    });
    setDeletingCardId(null);
    setError(null);
  }

  function editCard(card: KanbanCard) {
    setCardEditor({
      type: "edit",
      cardId: card.id,
      form: {
        title: card.title,
        prompt: card.prompt,
        model: card.model ?? defaultModel,
        directory: card.directory ?? null,
        useWorktree: card.useWorktree ?? false,
      },
    });
    setDeletingCardId(null);
    setError(null);
  }

  function closeCardEditor() {
    setCardEditor(null);
  }

  async function addCard(columnId: string) {
    const form = cardEditor?.form;
    const title = form?.title.trim();
    if (!form || !title) return;
    const model = form.model ?? defaultModel;
    const card: KanbanCard = {
      id: createId(),
      columnId,
      title,
      prompt: form.prompt.trim(),
      ...(model ? { model } : {}),
      ...(form.directory ? { directory: form.directory } : {}),
      ...(form.directory && form.useWorktree ? { useWorktree: true } : {}),
    };
    const saving = updateBoard((draft) => {
      if (!draft.columns.some(({ id }) => id === columnId)) {
        throw new Error("That column was removed before the card could be added.");
      }
      draft.cards.push(card);
    });
    closeCardEditor();
    await saving;
  }

  async function updateCard(cardId: string) {
    const form = cardEditor?.form;
    const title = form?.title.trim();
    if (!form || !title) return;
    const model = form.model ?? defaultModel;
    const saving = updateBoard((draft) => {
      const card = draft.cards.find((candidate) => candidate.id === cardId);
      if (!card) throw new Error("That card was removed before its changes could be saved.");
      card.title = title;
      card.prompt = form.prompt.trim();
      if (model) card.model = model;
      else delete card.model;
      if (form.directory) card.directory = form.directory;
      else delete card.directory;
      if (form.directory && form.useWorktree) card.useWorktree = true;
      else delete card.useWorktree;
    });
    closeCardEditor();
    await saving;
  }

  async function deleteCard(card: KanbanCard) {
    await runCardAction(card.id, "Unable to delete the card.", async () => {
      const removed = await updateBoard((draft) => {
        const currentCard = draft.cards.find((candidate) => candidate.id === card.id);
        if (!currentCard || currentCard.sessionId !== card.sessionId) {
          throw new Error("The card changed before it could be deleted.");
        }
        draft.cards = draft.cards.filter((candidate) => candidate.id !== card.id);
      });
      if (!removed) return;

      setDeletingCardId(null);
      try {
        if (card.sessionId) await actions.deleteSession(card.sessionId);
      } catch (error) {
        setError(
          "The card was deleted, but its session remains. " +
            describeError(error, "Delete it from the session list."),
        );
      }
    });
  }

  async function moveCard(cardId: string, columnId: string) {
    await updateBoard((draft) => {
      if (!draft.columns.some(({ id }) => id === columnId)) return;
      const card = draft.cards.find(({ id }) => id === cardId);
      if (card) card.columnId = columnId;
    });
  }

  async function startAgent(card: KanbanCard) {
    await runCardAction(card.id, "Unable to create the session.", async () => {
      const launch = sessionLaunchForCard(card);
      const { sessionId } = await actions.createSession(launch);

      const attached = await updateBoard((draft) => {
        const currentCard = draft.cards.find((candidate) => candidate.id === card.id);
        if (
          !currentCard ||
          currentCard.sessionId !== card.sessionId ||
          !hasSameSessionLaunch(currentCard, card)
        ) {
          throw new Error("The card changed before its session could be attached.");
        }
        currentCard.sessionId = sessionId;
      });
      if (attached) return;

      try {
        await actions.deleteSession(sessionId);
      } catch (error) {
        setError(
          "The session could not be attached to the card or cleaned up. " +
            describeError(error, "Delete it from the session list."),
        );
      }
    });
  }

  async function addColumn() {
    const title = newColumnTitle?.trim();
    if (!title) return;
    const column: KanbanColumn = {
      id: createId(),
      title,
      tone: "neutral",
    };
    const saving = updateBoard((draft) => {
      draft.columns.push(column);
    });
    setNewColumnTitle(null);
    requestAnimationFrame(() => {
      const board = boardRef.current;
      board?.scrollTo({ left: board.scrollWidth, behavior: "smooth" });
    });
    await saving;
  }

  async function deleteColumn(columnId: string) {
    await updateBoard((draft) => {
      const columns = draft.columns.filter((column) => column.id !== columnId);
      const fallback = columns[0];
      if (!fallback) return;
      draft.columns = columns;
      for (const card of draft.cards) {
        if (card.columnId === columnId) card.columnId = fallback.id;
      }
    });
  }

  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  return (
    <AppShell className="flex flex-col overflow-hidden">
      <AppHeader>
        <span className="flex size-9 items-center justify-center rounded-xl bg-user-accent/15 text-user-accent">
          <Kanban className="size-5" />
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-semibold">{appTitle}</h1>
          <p className="text-xs text-muted-foreground">
            {state.cards.length} {state.cards.length === 1 ? "card" : "cards"}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {newColumnTitle !== null ? (
            <form
              className="flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                void addColumn();
              }}
            >
              <AppInput
                value={newColumnTitle}
                onChange={(event) => setNewColumnTitle(event.currentTarget.value)}
                placeholder="Column name"
                aria-label="New column name"
                className="h-8 w-36"
                autoFocus
              />
              <AppButton type="submit" size="sm" disabled={!newColumnTitle.trim()}>
                Add
              </AppButton>
              <AppButton
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Cancel new column"
                onClick={() => setNewColumnTitle(null)}
              >
                <X className="size-4" />
              </AppButton>
            </form>
          ) : (
            <AppButton
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setNewColumnTitle("")}
            >
              <Plus className="size-4" />
              Column
            </AppButton>
          )}
        </div>
      </AppHeader>

      {error && (
        <AppAlert className="flex items-center justify-between rounded-none border-x-0 border-t-0 px-4 py-2 @md:px-6">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss error" onClick={() => setError(null)}>
            <X className="size-4" />
          </button>
        </AppAlert>
      )}

      <main
        ref={boardRef}
        className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden bg-muted/25 p-3 @md:p-5"
      >
        <div className="flex h-full min-w-max gap-3">
          {state.columns.map((column, columnIndex) => {
            const cards = state.cards.filter((card) => card.columnId === column.id);
            const isCreatingCard =
              cardEditor?.type === "create" && cardEditor.columnId === column.id;
            return (
              <section
                key={column.id}
                className="flex h-full w-[min(82cqw,20rem)] flex-col overflow-hidden rounded-xl border bg-background/80 shadow-sm"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (draggingCardIdRef.current) {
                    void moveCard(draggingCardIdRef.current, column.id);
                    draggingCardIdRef.current = null;
                  }
                }}
              >
                <div className="flex items-center gap-2 border-b px-3 py-2.5">
                  <span className={columnDotClass(column.tone)} />
                  <h2 className="font-medium">{column.title}</h2>
                  <AppBadge variant="secondary" className="ml-auto tabular-nums">
                    {cards.length}
                  </AppBadge>
                  {state.columns.length > 1 && (
                    <AppButton
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Delete ${column.title} column`}
                      onClick={() => void deleteColumn(column.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </AppButton>
                  )}
                </div>

                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
                  {cards.length === 0 && !isCreatingCard && (
                    <AppEmptyState
                      title="No cards yet"
                      description="Capture a task, then hand it to an agent when it is ready."
                      className="min-h-40 border-0 bg-transparent p-4"
                    >
                      <AppButton
                        size="sm"
                        variant="outline"
                        className="mt-2 gap-1.5"
                        onClick={() => openNewCard(column.id)}
                      >
                        <Plus className="size-4" />
                        Add card
                      </AppButton>
                    </AppEmptyState>
                  )}

                  {cards.map((card) => {
                    if (cardEditor?.type === "edit" && cardEditor.cardId === card.id) {
                      return (
                        <CardEditor
                          key={card.id}
                          form={cardEditor.form}
                          defaultModel={defaultModel}
                          submitLabel="Save changes"
                          onChange={updateCardForm}
                          onCancel={closeCardEditor}
                          onSubmit={() => void updateCard(card.id)}
                        />
                      );
                    }
                    const session = card.sessionId ? sessionById.get(card.sessionId) : undefined;
                    const modelName =
                      models.find((model) => model.id === card.model?.name)?.name ??
                      card.model?.name;
                    const isBusy = busyCardIds.has(card.id);
                    return (
                      <article
                        key={card.id}
                        draggable
                        onDragStart={() => {
                          draggingCardIdRef.current = card.id;
                        }}
                        onDragEnd={() => {
                          draggingCardIdRef.current = null;
                        }}
                        className="group/card rounded-lg border bg-card p-3 shadow-xs transition-shadow hover:shadow-sm"
                      >
                        <div className="flex items-start gap-2">
                          <GripVertical className="mt-0.5 size-4 shrink-0 cursor-grab text-muted-foreground/60" />
                          <div className="min-w-0 flex-1">
                            <h3 className="font-medium leading-snug">{card.title}</h3>
                            {card.prompt && (
                              <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-muted-foreground">
                                {card.prompt}
                              </p>
                            )}
                          </div>
                          <span className="flex shrink-0 @md:opacity-0 @md:group-hover/card:opacity-100 @md:focus-within:opacity-100">
                            <AppButton
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Edit ${card.title}`}
                              disabled={isBusy}
                              onClick={() => editCard(card)}
                            >
                              <Pencil className="size-3.5" />
                            </AppButton>
                            <AppButton
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              aria-label={
                                card.sessionId
                                  ? `Delete ${card.title} and its session`
                                  : `Delete ${card.title}`
                              }
                              disabled={isBusy}
                              onClick={() => {
                                if (card.sessionId) {
                                  setDeletingCardId(card.id);
                                } else {
                                  void deleteCard(card);
                                }
                              }}
                            >
                              <Trash2 className="size-3.5" />
                            </AppButton>
                          </span>
                        </div>

                        {(modelName || card.directory) && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {modelName && (
                              <AppBadge variant="outline" className="max-w-full truncate">
                                {modelName}
                                {card.model?.reasoningEffort
                                  ? ` · ${card.model.reasoningEffort}`
                                  : ""}
                              </AppBadge>
                            )}
                            {card.directory && (
                              <AppBadge variant="outline" className="max-w-full truncate">
                                {card.useWorktree ? "Worktree · " : ""}
                                {card.directory}
                              </AppBadge>
                            )}
                          </div>
                        )}

                        {deletingCardId === card.id && (
                          <div className="mt-3 rounded-md border border-destructive/25 bg-destructive/10 p-2.5 text-xs">
                            <p>Delete this card and its Toy Box session?</p>
                            <div className="mt-2 flex justify-end gap-1.5">
                              <AppButton
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => setDeletingCardId(null)}
                              >
                                Cancel
                              </AppButton>
                              <AppButton
                                type="button"
                                size="sm"
                                variant="destructive"
                                disabled={isBusy}
                                onClick={() => void deleteCard(card)}
                              >
                                {isBusy && <Loader2 className="size-3.5 animate-spin" />}
                                Delete both
                              </AppButton>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap items-center gap-1.5">
                          {session ? (
                            <>
                              <AppSessionStatus status={session.status} />
                              <AppSessionToggle sessionId={session.id} />
                            </>
                          ) : (
                            <AppButton
                              size="sm"
                              variant="outline"
                              className="h-7 gap-1.5 px-2 text-xs"
                              disabled={isBusy}
                              onClick={() => void startAgent(card)}
                            >
                              {isBusy ? (
                                <Loader2 className="size-3.5 animate-spin" />
                              ) : (
                                <Sparkles className="size-3.5" />
                              )}
                              Start agent
                            </AppButton>
                          )}

                          <AppSharePicker
                            mimeType="x-session-launch"
                            content={sessionLaunchForCard(card)}
                            disabled={isBusy}
                          />

                          <span className="ml-auto flex items-center gap-0.5">
                            <AppButton
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              disabled={columnIndex === 0}
                              aria-label={`Move ${card.title} left`}
                              onClick={() =>
                                void moveCard(card.id, state.columns[columnIndex - 1]!.id)
                              }
                            >
                              <ArrowLeft className="size-3.5" />
                            </AppButton>
                            <AppButton
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              disabled={columnIndex === state.columns.length - 1}
                              aria-label={`Move ${card.title} right`}
                              onClick={() =>
                                void moveCard(card.id, state.columns[columnIndex + 1]!.id)
                              }
                            >
                              <ArrowRight className="size-3.5" />
                            </AppButton>
                          </span>
                        </div>
                      </article>
                    );
                  })}

                  {isCreatingCard && (
                    <CardEditor
                      form={cardEditor.form}
                      defaultModel={defaultModel}
                      submitLabel="Add card"
                      onChange={updateCardForm}
                      onCancel={closeCardEditor}
                      onSubmit={() => void addCard(column.id)}
                    />
                  )}
                </div>

                {cards.length > 0 && !isCreatingCard && (
                  <div className="border-t p-2">
                    <AppButton
                      variant="ghost"
                      size="sm"
                      className="w-full justify-start gap-1.5 text-muted-foreground"
                      onClick={() => openNewCard(column.id)}
                    >
                      <Plus className="size-4" />
                      Add card
                    </AppButton>
                  </div>
                )}
              </section>
            );
          })}

          {state.columns.length === 0 && (
            <AppEmptyState
              title="This board needs a column"
              description="Add a column to start organizing work."
              className="h-full w-[min(82cqw,24rem)]"
            >
              <AppButton className="mt-2 gap-1.5" onClick={() => setNewColumnTitle("")}>
                <Plus className="size-4" />
                Add column
              </AppButton>
            </AppEmptyState>
          )}
        </div>
      </main>
    </AppShell>
  );
}

function CardEditor({
  form,
  defaultModel,
  submitLabel,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: CardForm;
  defaultModel: CardForm["model"];
  submitLabel: string;
  onChange: (patch: Partial<CardForm>) => void;
  onCancel: () => void;
  onSubmit: () => void;
}) {
  const model = form.model ?? defaultModel;
  return (
    <form
      className="space-y-2 rounded-lg border bg-card p-3 shadow-sm"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <AppInput
        value={form.title}
        onChange={(event) => onChange({ title: event.currentTarget.value })}
        placeholder="Card title"
        aria-label="Card title"
        autoFocus
      />
      <AppTextarea
        value={form.prompt}
        onChange={(event) => onChange({ prompt: event.currentTarget.value })}
        placeholder="Agent prompt (optional)"
        aria-label="Agent prompt"
        rows={3}
      />
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded-md border bg-muted/20 px-1.5 py-1">
        {model ? (
          <AppModelPicker value={model} onValueChange={(model) => onChange({ model })} />
        ) : (
          <span className="px-1.5 text-xs text-muted-foreground">Loading models…</span>
        )}
        <AppLocationPicker
          value={form.directory}
          onValueChange={(directory) =>
            onChange({
              directory,
              ...(!directory ? { useWorktree: false } : {}),
            })
          }
          useWorktree={form.useWorktree}
          onUseWorktreeChange={(useWorktree) => onChange({ useWorktree })}
        />
      </div>
      <div className="flex justify-end gap-2">
        <AppButton type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </AppButton>
        <AppButton type="submit" size="sm" disabled={!form.title.trim()}>
          {submitLabel}
        </AppButton>
      </div>
    </form>
  );
}

function columnDotClass(tone: KanbanColumn["tone"]): string {
  const color =
    tone === "accent"
      ? "bg-user-accent"
      : tone === "success"
        ? "bg-emerald-500"
        : "bg-muted-foreground";
  return `size-2.5 rounded-full ${color}`;
}
