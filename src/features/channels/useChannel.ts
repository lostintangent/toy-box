import { useEffect, useState } from "react";
import { useHydrated } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadChannelHistory } from "./queryCache";
import { channelMutations } from "./mutations";
import { channelQueries } from "./queries";
import { usePageVisibility } from "@/shared/hooks/usePageVisibility";
import { generateUUID } from "@/shared/utils";
import type { PostChannelMessageInput } from "./model";

/** Shared channel observation; passive observers leave unread state untouched. */
export function useChannel(
  channelId: string,
  { visible = true, mode = "active" }: { visible?: boolean; mode?: "active" | "passive" } = {},
) {
  const queryClient = useQueryClient();
  const hydrated = useHydrated();
  const pageIsVisible = usePageVisibility();
  const isVisible = visible && pageIsVisible;
  const options = channelQueries.detail(channelId);
  const [reading, setReading] = useState(() => ({
    visible: false,
    arrivalId: queryClient.getQueryData(options.queryKey)?.arrival.id,
    unreadAfter: undefined as number | null | undefined,
  }));
  const { data: state } = useQuery({
    ...options,
    enabled: hydrated && isVisible,
    subscribed: hydrated && isVisible,
    throwOnError: true,
  });
  const arrival = state?.arrival;
  const isReading = isVisible && mode === "active";
  if (isReading !== reading.visible) {
    // Joining an existing observer reads its current cache; a new connection waits for arrival.
    const shared = queryClient.getQueryCache().find({ queryKey: options.queryKey })?.isActive();
    const channel = isReading && shared ? state?.channel : undefined;
    setReading({
      visible: isReading,
      arrivalId: arrival?.id,
      unreadAfter: channel
        ? channel.seenThrough < channel.latestSequence
          ? channel.seenThrough
          : null
        : undefined,
    });
  } else if (
    isReading &&
    reading.unreadAfter === undefined &&
    arrival &&
    arrival.id !== reading.arrivalId
  ) {
    setReading({ visible: true, arrivalId: arrival.id, unreadAfter: arrival.unreadAfter });
  }

  const { mutate: markRead } = useMutation(channelMutations.markRead());
  const { mutate: post } = useMutation(channelMutations.post());
  const latestSequence = state?.channel.latestSequence;
  const seenThrough = state?.channel.seenThrough;
  useEffect(() => {
    if (
      !isReading ||
      reading.unreadAfter === undefined ||
      latestSequence === undefined ||
      seenThrough === undefined ||
      seenThrough >= latestSequence
    )
      return;
    markRead({ channelId, sequence: latestSequence });
  }, [channelId, isReading, latestSequence, markRead, seenThrough, reading.unreadAfter]);

  const loadPrevious = (throughSequence?: number) =>
    loadChannelHistory(queryClient, channelId, throughSequence).catch((error: unknown) =>
      console.error("Failed to load previous Channel messages:", error),
    );

  const postMessage = (message: Pick<PostChannelMessageInput, "content" | "attachments">) =>
    post({ ...message, channelId, id: generateUUID() });

  if (state === null) throw new Error("This channel has been deleted.");
  return { state, unreadAfter: reading.unreadAfter, loadPrevious, postMessage };
}
