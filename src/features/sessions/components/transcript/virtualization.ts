const MESSAGE_WINDOW_SIZE = 20;

export type MessageWindow = {
  readonly startIndex: number;
  readonly messageCount: number;
};

export function createMessageWindow(
  messageCount: number,
  windowSize = MESSAGE_WINDOW_SIZE,
): MessageWindow {
  return {
    startIndex: Math.max(0, messageCount - windowSize),
    messageCount,
  };
}

/** Preserve an escaped reader's start as output grows; otherwise reconcile to the latest window. */
export function reconcileMessageWindow(
  current: MessageWindow,
  messageCount: number,
  isPinned: boolean,
  windowSize = MESSAGE_WINDOW_SIZE,
): MessageWindow {
  if (messageCount === current.messageCount) return current;
  if (messageCount < current.messageCount) {
    return createMessageWindow(messageCount, windowSize);
  }

  return isPinned ? createMessageWindow(messageCount, windowSize) : { ...current, messageCount };
}

export function revealPreviousMessageWindow(
  current: MessageWindow,
  chunkSize = MESSAGE_WINDOW_SIZE,
): MessageWindow {
  if (current.startIndex === 0) return current;
  return {
    ...current,
    startIndex: Math.max(0, current.startIndex - chunkSize),
  };
}
