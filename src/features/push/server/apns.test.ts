import { expect, onTestFinished, spyOn, test } from "bun:test";
import { defaultPushRelayURL, notificationPayload, RelaySender, type APNsMessage } from "./apns";

const message: APNsMessage = {
  token: "aabb",
  environment: "production",
  pushType: "alert",
  priority: 10,
  expiration: 1793086200.125,
  collapseID: "request",
  payload: { aps: { alert: "Toy Box" } },
};

test("the server builds Apple's request without any Apple credential", async () => {
  const sending = spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
  onTestFinished(() => sending.mockRestore());
  expect(await new RelaySender(defaultPushRelayURL).send(message)).toEqual({ status: 200 });
  const [url, options] = sending.mock.calls[0]!;
  expect(url).toBe("https://toy-box-push-relay.lostintangent.workers.dev/production/3/device/aabb");
  expect(options?.method).toBe("POST");
  expect(options?.redirect).toBe("error");
  expect(options?.signal).toBeInstanceOf(AbortSignal);
  expect(options?.body).toBe(JSON.stringify(message.payload));
  const headers = new Headers(options?.headers);
  expect(headers.get("apns-push-type")).toBe("alert");
  expect(headers.get("apns-priority")).toBe("10");
  expect(headers.get("apns-expiration")).toBe("1793086200");
  expect(headers.get("apns-collapse-id")).toBe("request");
  expect(headers.get("authorization")).toBeNull();
  expect(headers.get("apns-topic")).toBeNull();
});

test("Apple rejections and relay failures cannot become successful deliveries", async () => {
  const sending = spyOn(globalThis, "fetch");
  onTestFinished(() => sending.mockRestore());
  const sender = new RelaySender("http://127.0.0.1:8787/");
  for (const status of [404, 503]) {
    sending.mockResolvedValueOnce(new Response(null, { status }));
    expect(await sender.send(message)).toEqual({ status });
  }
  sending.mockResolvedValueOnce(Response.json({ reason: "ExpiredToken" }, { status: 410 }));
  expect(await sender.send(message)).toEqual({ status: 410, reason: "ExpiredToken" });
  for (const body of ["<html>error code: 1101</html>", JSON.stringify({ reason: false })]) {
    sending.mockResolvedValueOnce(new Response(body, { status: 400 }));
    expect(await sender.send(message)).toEqual({ status: 400 });
  }
  expect(sending.mock.calls[0]?.[0]).toBe("http://127.0.0.1:8787/production/3/device/aabb");
});

test("Unicode alert text fits the actual APNs byte budget without losing routing or grouping", () => {
  const family = "\u{1f468}\u200d\u{1f469}\u200d\u{1f467}\u200d\u{1f466}";
  const event = {
    type: "notification" as const,
    key: "channel:request",
    title: "Studio",
    body: family.repeat(400),
    category: "request",
    threadID: "channel",
    data: { kind: "request", channelID: "channel", sequence: 15, handle: "lead" },
  };
  const payload = notificationPayload(event, "registration");
  expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThanOrEqual(4096);
  expect(payload).toMatchObject({
    registrationID: "registration",
    channelID: "channel",
    sequence: 15,
    handle: "lead",
    aps: { "thread-id": "registration:channel", category: "request" },
  });
  expect(payload.aps).not.toHaveProperty("badge");
  expect(payload.aps.alert.body).toEndWith("\u2026");
  expect(payload.aps.alert.body.slice(0, -1).split(family).join("")).toBe("");
  expect(() => notificationPayload({ ...event, title: "x".repeat(5000) }, "registration")).toThrow(
    "4096-byte",
  );
});
