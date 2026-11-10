import { describe, expect, test } from "bun:test";
import { H3 } from "h3";
import compression from "./middleware/compression";

describe("response compression", () => {
  test.each([
    ["text/html; charset=utf-8", "gzip, deflate, br, zstd", "br"],
    ["application/json; charset=utf-8", "gzip, deflate", "gzip"],
    ["text/event-stream; charset=utf-8", "gzip, deflate, br", "gzip"],
    ["application/x-tss-framed; v=1", "gzip, deflate, br", "gzip"],
  ] as const)("flushes %s for %s as %s", async (contentType, acceptEncoding, encoding) => {
    const body = "compressible response ".repeat(100);
    const stream = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        // Leave the stream open to prove each write reaches the client before the response ends.
      },
    });
    const response = await request(
      new Response(stream, {
        headers: { "Content-Type": contentType, "Content-Length": String(body.length) },
      }),
      acceptEncoding,
    );

    expect(response.headers.get("Content-Encoding")).toBe(encoding);
    expect(response.headers.get("Vary")).toContain("Accept-Encoding");
    expect(response.headers.get("Content-Length")).toBeNull();
    // Bun decodes brotli, though the DOM's CompressionFormat doesn't name it.
    const format = (encoding === "br" ? "brotli" : "gzip") as CompressionFormat;
    const reader = response.body!.pipeThrough(new DecompressionStream(format)).getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe(body);
    await reader.cancel();
  });

  test("leaves JSON readable when the client does not accept compression", async () => {
    const response = await request(Response.json({ ready: true }), "identity");
    expect(response.headers.get("Content-Encoding")).toBeNull();
    expect(response.headers.get("Vary")).toContain("Accept-Encoding");
    expect(await response.json()).toEqual({ ready: true });
  });

  test("preserves an existing encoding", async () => {
    const body = Bun.gzipSync(JSON.stringify({ ready: true }));
    const response = await request(
      new Response(body, {
        headers: { "Content-Type": "application/json", "Content-Encoding": "gzip" },
      }),
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(body);
  });
});

function request(response: Response, acceptEncoding = "gzip") {
  const app = new H3().use(compression).get("/", () => response);
  return app.fetch(
    new Request("http://localhost/", { headers: { "Accept-Encoding": acceptEncoding } }),
  );
}
