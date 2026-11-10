// A window bounds the rendered messages by transcript position, so loading a
// previous page leaves it unchanged. `positions` lists the messages in view, ascending.

const MESSAGE_WINDOW_SIZE = 20;

export type MessageWindow = {
  readonly startPosition: number;
  readonly lastPosition: number;
};

export function createMessageWindow(
  positions: readonly number[],
  windowSize = MESSAGE_WINDOW_SIZE,
): MessageWindow {
  return {
    startPosition: positions[Math.max(0, positions.length - windowSize)] ?? 0,
    lastPosition: positions.at(-1) ?? -1,
  };
}

/** Preserve an escaped reader's start as output grows; otherwise reconcile to the latest window. */
export function reconcileMessageWindow(
  current: MessageWindow,
  positions: readonly number[],
  isPinned: boolean,
  windowSize = MESSAGE_WINDOW_SIZE,
): MessageWindow {
  const lastPosition = positions.at(-1) ?? -1;
  if (lastPosition === current.lastPosition) return current;
  if (lastPosition < current.lastPosition) {
    return createMessageWindow(positions, windowSize);
  }

  return isPinned ? createMessageWindow(positions, windowSize) : { ...current, lastPosition };
}

export function revealPreviousMessageWindow(
  current: MessageWindow,
  positions: readonly number[],
  chunkSize = MESSAGE_WINDOW_SIZE,
): MessageWindow {
  const startIndex = positions.findIndex((position) => position >= current.startPosition);
  if (startIndex <= 0) return current;
  return {
    ...current,
    startPosition: positions[Math.max(0, startIndex - chunkSize)],
  };
}
