import { z } from "zod";
import { conciseChannelMessageSchema, durableIdSchema } from "@channels/model";
import { NotFoundError } from "@/shared/server/http";
import { getServer } from "@workspace/server/installation";
import { post, read, readServer } from "@workspace/server/links";
import { getSettings } from "@workspace/server/state/settings";

// Leads reach the Channels on the owner's linked servers, which Workspace links. Each linked
// server lists its Channels under the name it gives itself, and takes messages to their leads at
// its link.

/** A linked server's lead delivers its message here, naming its channel and server as they name
 *  themselves. */
export const linkedLeadMessageInputSchema = z
  .object({
    channelId: durableIdSchema,
    from: durableIdSchema,
    channelName: z.string().min(1),
    server: z.string().min(1),
    content: conciseChannelMessageSchema,
  })
  .strict();
export type LinkedLeadMessageInput = z.infer<typeof linkedLeadMessageInputSchema>;

/** Every answering linked server's channels, which a lead can message but not open, with that
 *  server's name as `server`. */
export async function listLinkedChannels() {
  return (await readLinkedServers()).flatMap(({ server, channels }) =>
    channels.map((channel) => ({ ...channel, server })),
  );
}

/** Delivers a lead's message to a channel on a linked server, once. The peer answers when its
 *  lead accepts the message, which can wait on a cold start, so the bound is generous and a
 *  message that may have landed is never resent. */
export async function messageLinkedChannelLead(
  sender: { id: string; name: string },
  { channelId, content }: { channelId: string; content: string },
): Promise<void> {
  const target = (await readLinkedServers()).find(({ channels }) =>
    channels.some((channel) => channel.channelId === channelId),
  );
  if (!target) throw new NotFoundError("Channel");
  const url = `${target.link}/api/v1/channels/${encodeURIComponent(channelId)}/lead-messages`;
  const { name: server } = await getServer();
  const message = { from: sender.id, channelName: sender.name, server, content };
  await post(url, message, 60_000).catch(() => {
    throw new Error(`Couldn't deliver to ${target.server}.`);
  });
}

const catalogSchema = z.object({
  channels: z.array(z.object({ id: z.string(), name: z.string(), purpose: z.string().nullish() })),
});

/** Every answering linked server with its channels. One that doesn't answer within the bound lists
 *  none, so one sleeping machine never hides the others. */
async function readLinkedServers() {
  const answers = await Promise.allSettled((await getSettings()).serverLinks.map(readLinkedServer));
  return answers.flatMap((answer) => (answer.status === "fulfilled" ? [answer.value] : []));
}

async function readLinkedServer(link: string) {
  const [server, { channels }] = await Promise.all([
    readServer(link),
    read(`${link}/api/v1/channels`, catalogSchema),
  ]);
  return {
    link,
    server: server.name,
    channels: channels.map(({ id, name, purpose }) => ({
      channelId: id,
      name,
      ...(purpose ? { purpose } : {}),
    })),
  };
}
