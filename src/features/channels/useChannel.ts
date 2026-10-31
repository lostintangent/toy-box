import { useEffect, useState } from "react";
import { useHydrated } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { loadChannelHistory } from "./cache";
import { channelMutations } from "./mutations";
import { channelQueries, type ChannelQueryData } from "./queries";
import { usePageVisibility } from "@/shared/hooks/usePageVisibility";
import { generateUUID } from "@/shared/utils";
import { channelUnreadAfter, type Channel, type PostChannelMessageInput } from "./model";

/**
 * One visit's unread position. A visit that joins an active observer reads its cache at once;
 * otherwise it awaits the connection's next arrival. Either way, arrivals during the visit never
 * move it, and leaving ends it.
 */
export type ChannelVisit =
  | { status: "away" }
  | { status: "arriving"; afterArrival?: number }
  | { status: "reading"; unreadAfter: number | null };

export function nextChannelVisit(
  visit: ChannelVisit,
  {
    reading,
    joined,
    arrival,
  }: {
    reading: boolean;
    /** The cached Channel, when another observer already holds the connection open. */
    joined?: Channel;
    arrival?: ChannelQueryData["arrival"];
  },
): ChannelVisit {
  if (!reading) return visit.status === "away" ? visit : { status: "away" };
  if (visit.status === "away") {
    return joined
      ? { status: "reading", unreadAfter: channelUnreadAfter(joined) }
      : { status: "arriving", afterArrival: arrival?.id };
  }
  if (visit.status === "arriving" && arrival && arrival.id !== visit.afterArrival) {
    return { status: "reading", unreadAfter: arrival.unreadAfter };
  }
  return visit;
}

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
  const [visit, setVisit] = useState<ChannelVisit>({ status: "away" });
  const { data: state } = useQuery({
    ...options,
    enabled: hydrated && isVisible,
    subscribed: hydrated && isVisible,
    throwOnError: true,
  });
  const observed = queryClient.getQueryCache().find({ queryKey: options.queryKey })?.isActive();
  const nextVisit = nextChannelVisit(visit, {
    reading: isVisible && mode === "active",
    joined: observed ? state?.channel : undefined,
    arrival: state?.arrival,
  });
  if (nextVisit !== visit) setVisit(nextVisit);

  const { mutate: markRead } = useMutation(channelMutations.markRead());
  const { mutate: post } = useMutation(channelMutations.post());
  const latestSequence = state?.channel.latestSequence;
  const seenThrough = state?.channel.seenThrough;
  // Reading acknowledges only after the visit has captured where unread messages begin.
  const isReading = visit.status === "reading";
  useEffect(() => {
    if (
      !isReading ||
      latestSequence === undefined ||
      seenThrough === undefined ||
      seenThrough >= latestSequence
    )
      return;
    markRead({ channelId, sequence: latestSequence });
  }, [channelId, isReading, latestSequence, markRead, seenThrough]);

  const loadPrevious = (throughSequence?: number) =>
    loadChannelHistory(queryClient, channelId, throughSequence).catch((error: unknown) =>
      console.error("Failed to load previous Channel messages:", error),
    );

  const postMessage = (message: Pick<PostChannelMessageInput, "content" | "attachments">) =>
    post({ ...message, channelId, id: generateUUID() });

  if (state === null) throw new Error("This channel has been deleted.");
  /** Where unread messages began on arrival; null means read, undefined awaits arrival. */
  const unreadAfter = visit.status === "reading" ? visit.unreadAfter : undefined;
  return { state, unreadAfter, loadPrevious, postMessage };
}
