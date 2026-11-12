import { createFileRoute } from "@tanstack/react-router";
import { bookmarkChannelMessageInputSchema } from "@channels/model";
import { bookmarkChannelMessage } from "@channels/server";
import { invalidRequest, respond } from "@/shared/server/http";

/** Bookmarking is idempotent, so either verb succeeds when the message is already in that state. */
export const Route = createFileRoute("/api/v1/channels/$channelId/bookmarks/$sequence")({
  server: {
    handlers: {
      PUT: ({ params }) => bookmark(params, true),
      DELETE: ({ params }) => bookmark(params, false),
    },
  },
});

function bookmark(params: { channelId: string; sequence: string }, bookmarked: boolean) {
  const { channelId, sequence } = params;
  const input = bookmarkChannelMessageInputSchema.safeParse({
    channelId,
    sequence: Number(sequence),
    bookmarked,
  });
  if (!input.success) return invalidRequest();
  return respond(`${bookmarked ? "bookmark" : "unbookmark"} message ${sequence}`, () =>
    bookmarkChannelMessage(input.data),
  );
}
