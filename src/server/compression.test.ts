import { describe, expect, test } from "bun:test";
import { H3 } from "h3";
import compression from "./middleware/compression";

describe("response compression", () => {
  test.each(["text/html; charset=utf-8", "application/json; charset=utf-8"])(
    "compresses %s when gzip is accepted",
    async (contentType) => {
      const body = "compressible response ".repeat(100);
      const response = await request(
        new Response(body, {
          headers: { "Content-Type": contentType, "Content-Length": String(body.length) },
        }),
      );

      expect(response.headers.get("Content-Encoding")).toBe("gzip");
      expect(response.headers.get("Vary")).toContain("Accept-Encoding");
      expect(response.headers.get("Content-Length")).toBeNull();
      expect(
        await new Response(response.body!.pipeThrough(new DecompressionStream("gzip"))).text(),
      ).toBe(body);
    },
  );

  test.each(["text/event-stream", "application/x-tss-framed; v=1"])(
    "preserves immediate streaming for %s",
    async (contentType) => {
      const body = new ReadableStream<Uint8Array<ArrayBuffer>>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("first event"));
          // Leave the stream open to prove that middleware does not wait for completion.
        },
      });
      const response = await request(
        new Response(body, { headers: { "Content-Type": contentType } }),
      );

      expect(response.headers.get("Content-Encoding")).toBeNull();
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toBe("first event");
      await reader.cancel();
    },
  );

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
