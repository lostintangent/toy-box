import { z } from "zod";
import { frameSizeSchema, screenInputSchema, type ScreenStatus } from "./index";

/**
 * What a viewer sends over its socket. The socket's URL names the screen it views and may
 * give the viewer's size (`width` and `height`), which `resize` changes.
 */
export const screenClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ack"), sequence: z.number().int().positive() }).strict(),
  z.object({ type: z.literal("resize"), size: frameSizeSchema }).strict(),
  z.object({ type: z.literal("take-control") }).strict(),
  z.object({ type: z.literal("release-control") }).strict(),
  z
    .object({ type: z.literal("input"), actions: z.array(screenInputSchema).min(1).max(64) })
    .strict(),
]);
export type ScreenClientMessage = z.infer<typeof screenClientMessageSchema>;

/**
 * What the server sends a viewer as text. Frames arrive as binary packets. A screen that
 * ends or never opens says so before the server closes its viewers; a viewer reconnects
 * after any other close.
 */
export type ScreenServerMessage =
  | {
      type: "state";
      /** Known once the screen opens. */
      title?: string;
      status: ScreenStatus;
      /** Why the screen is paused or ended. */
      reason?: string;
      hasControl: boolean;
    }
  | { type: "error"; message: string };

/**
 * Packets are two big-endian 32-bit lengths, JSON metadata, then a binary payload. The
 * helper writes them, and the server forwards frame packets to viewers byte for byte.
 */
type ScreenPacket = { metadata: unknown; payload: Uint8Array; bytes: Uint8Array };

const HEADER_BYTES = 8;
const decoder = new TextDecoder("utf-8", { fatal: true });

export function decodeScreenPacket(bytes: Uint8Array): ScreenPacket {
  if (bytes.length < HEADER_BYTES) throw new Error("Incomplete screen packet header.");
  const [metadataLength, payloadLength] = readHeader(bytes);
  if (bytes.length !== HEADER_BYTES + metadataLength + payloadLength)
    throw new Error("Screen packet length does not match its header.");
  const payloadStart = HEADER_BYTES + metadataLength;
  return {
    metadata: JSON.parse(decoder.decode(bytes.subarray(HEADER_BYTES, payloadStart))),
    payload: bytes.subarray(payloadStart),
    bytes,
  };
}

/** Reads packets from a byte stream, such as a pipe, which can split them anywhere. */
export class ScreenPacketReader {
  #header = new Uint8Array(HEADER_BYTES);
  #headerOffset = 0;
  #packet: Uint8Array | undefined;
  #offset = 0;

  push(chunk: Uint8Array): ScreenPacket[] {
    const packets: ScreenPacket[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      if (!this.#packet) {
        const length = Math.min(HEADER_BYTES - this.#headerOffset, chunk.length - offset);
        this.#header.set(chunk.subarray(offset, offset + length), this.#headerOffset);
        this.#headerOffset += length;
        offset += length;
        if (this.#headerOffset !== HEADER_BYTES) continue;
        // Allocate each packet once, at its full size.
        const [metadataLength, payloadLength] = readHeader(this.#header);
        this.#packet = new Uint8Array(HEADER_BYTES + metadataLength + payloadLength);
        this.#packet.set(this.#header);
        this.#offset = HEADER_BYTES;
      }
      const length = Math.min(this.#packet.length - this.#offset, chunk.length - offset);
      this.#packet.set(chunk.subarray(offset, offset + length), this.#offset);
      this.#offset += length;
      offset += length;
      if (this.#offset === this.#packet.length) {
        packets.push(decodeScreenPacket(this.#packet));
        this.#packet = undefined;
        this.#headerOffset = 0;
        this.#offset = 0;
      }
    }
    return packets;
  }

  /** Throws if the stream ended partway through a packet. */
  end(): void {
    if (this.#headerOffset || this.#packet) throw new Error("Screen stream ended mid-packet.");
  }
}

function readHeader(bytes: Uint8Array): [metadataLength: number, payloadLength: number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return [view.getUint32(0), view.getUint32(4)];
}
