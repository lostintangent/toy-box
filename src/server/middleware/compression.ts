import { onResponse } from "h3";
import { Duplex } from "node:stream";
import { constants, createBrotliCompress, createGzip } from "node:zlib";

// Both codecs flush every write, so each streamed event and keepalive leaves at once.
const compressors = {
  br: () =>
    createBrotliCompress({
      flush: constants.BROTLI_OPERATION_FLUSH,
      params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
    }),
  gzip: () => createGzip({ flush: constants.Z_SYNC_FLUSH }),
};

// Long-lived streams take gzip alone, since brotli holds about 1 MB per open stream.
const encodings = new Map<string, (keyof typeof compressors)[]>([
  ["text/html", ["br", "gzip"]],
  ["application/json", ["br", "gzip"]],
  ["text/event-stream", ["gzip"]],
  ["application/x-tss-framed", ["gzip"]],
]);

export default onResponse((response, event) => {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const candidates = contentType && encodings.get(contentType);
  if (!candidates) return;

  response.headers.append("Vary", "Accept-Encoding");
  const accepted = event.req.headers.get("accept-encoding") ?? "";
  const encoding = candidates.find((name) => accepted.includes(name));
  if (!encoding || !response.body || response.headers.has("Content-Encoding")) return;

  response.headers.set("Content-Encoding", encoding);
  response.headers.delete("Content-Length");
  // Node and the DOM declare web streams separately, so the converted pair needs a cast.
  const compressor = Duplex.toWeb(compressors[encoding]()) as unknown as ReadableWritablePair;
  return new Response(response.body.pipeThrough(compressor), response);
});
