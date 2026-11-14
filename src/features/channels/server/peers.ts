import { z } from "zod";
import { conciseChannelMessageSchema, durableIdSchema } from "@channels/model";
import { NotFoundError } from "@/shared/server/http";
import { getServer } from "@workspace/server/installation";
import { listPeers, post, read, readServer } from "@workspace/server/peers";

// Leads reach the Channels on the owner's peer servers, the other Toy Box Macs on its tailnet,
// which Workspace lists. Each peer server lists its Channels under the name it gives itself, and
// takes messages to their leads at its origin.

/** A peer server's lead delivers its message here, naming its channel and server as they name
 *  themselves. */
export const peerLeadMessageInputSchema = z
  .object({
    channelId: durableIdSchema,
    from: durableIdSchema,
    channelName: z.string().min(1),
    server: z.string().min(1),
    content: conciseChannelMessageSchema,
  })
  .strict();
export type PeerLeadMessageInput = z.infer<typeof peerLeadMessageInputSchema>;

/** Every answering peer server's channels, which a lead can message but not open, with that
 *  server's name as `server`. */
export async function listPeerChannels() {
  return (await readPeerServers()).flatMap(({ server, channels }) =>
    channels.map((channel) => ({ ...channel, server })),
  );
}

/** Delivers a lead's message to a channel on a peer server, once. The peer answers when its
 *  lead accepts the message, which can wait on a cold start, so the bound is generous and a
 *  message that may have landed is never resent. */
export async function messagePeerChannelLead(
  sender: { id: string; name: string },
  { channelId, content }: { channelId: string; content: string },
): Promise<void> {
  const [peers, { name: server }] = await Promise.all([readPeerServers(), getServer()]);
  const target = peers.find(({ channels }) =>
    channels.some((channel) => channel.channelId === channelId),
  );
  if (!target) throw new NotFoundError("Channel");
  const url = `${target.origin}/api/v1/channels/${encodeURIComponent(channelId)}/lead-messages`;
  const message = { from: sender.id, channelName: sender.name, server, content };
  await post(url, message, 60_000).catch(() => {
    throw new Error(`Couldn't deliver to ${target.server}.`);
  });
}

const catalogSchema = z.object({
  channels: z.array(z.object({ id: z.string(), name: z.string(), purpose: z.string().nullish() })),
});

/** Every answering peer server with its channels. One that doesn't answer within the bound lists
 *  none, so one sleeping machine never hides the others. */
async function readPeerServers() {
  const answers = await Promise.allSettled((await listPeers()).map(readPeerServer));
  return answers.flatMap((answer) => (answer.status === "fulfilled" ? [answer.value] : []));
}

async function readPeerServer(origin: string) {
  const [server, { channels }] = await Promise.all([
    readServer(origin),
    read(`${origin}/api/v1/channels`, catalogSchema),
  ]);
  return {
    origin,
    server: server.name,
    channels: channels.map(({ id, name, purpose }) => ({
      channelId: id,
      name,
      ...(purpose ? { purpose } : {}),
    })),
  };
}
