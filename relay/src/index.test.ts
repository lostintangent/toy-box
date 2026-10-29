import { expect, onTestFinished, spyOn, test } from "bun:test";
import worker from ".";

test("the relay pins credentials and passes Apple's request and response through", async () => {
  const key = async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
      "sign",
      "verify",
    ]);
    if (!("privateKey" in pair)) throw new Error("Expected a synthetic key pair.");
    return pair.privateKey;
  };
  const env = { APNS_KEY_ID: "test-key", APNS_PRIVATE_KEY: await key() };
  const apple = spyOn(globalThis, "fetch");
  onTestFinished(() => apple.mockRestore());
  const headers = () => new Headers(apple.mock.calls.at(-1)?.[1]?.headers);
  const payload = JSON.stringify({ aps: { alert: "native \u00e9 stream" } });
  const send = (
    environment: string,
    pushType: string,
    answer = new Response(null, { status: 200 }),
  ) => {
    apple.mockResolvedValueOnce(answer);
    return worker.fetch(
      new Request(`https://relay.test/${environment}/3/device/aAbB`, {
        method: "POST",
        headers: {
          "apns-push-type": pushType,
          "apns-priority": "10",
          "apns-expiration": "123",
          "apns-collapse-id": "request",
          "apns-topic": "another.app",
          authorization: "caller-credential",
          host: "not-apple.invalid",
          cookie: "private",
        },
        body: payload,
      }),
      env,
    );
  };
  for (const environment of ["sandbox", "production"])
    for (const pushType of ["alert", "liveactivity"]) {
      const answer = new Response("Apple's body", {
        status: 400,
        headers: { "apns-id": "test-id" },
      });
      expect(await send(environment, pushType, answer)).toBe(answer);
      expect(apple.mock.calls.at(-1)?.[0]).toBe(
        `https://${environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com"}/3/device/aAbB`,
      );
      expect(headers().get("apns-topic")).toBe(
        `dev.toybox.mobile${pushType === "liveactivity" ? ".push-type.liveactivity" : ""}`,
      );
      expect(headers().get("authorization")).toStartWith("bearer ");
      expect(headers().get("apns-priority")).toBe("10");
      expect(headers().get("apns-expiration")).toBe("123");
      expect(headers().get("apns-collapse-id")).toBe("request");
      expect(headers().get("host")).toBeNull();
      expect(headers().get("cookie")).toBeNull();
      expect(apple.mock.calls.at(-1)?.[1]?.redirect).toBe("manual");
      expect(await new Response(apple.mock.calls.at(-1)?.[1]?.body).text()).toBe(payload);
    }
  const original = headers().get("authorization");
  await send("sandbox", "alert");
  expect(headers().get("authorization")).toBe(original);
  env.APNS_PRIVATE_KEY = await key();
  await send("sandbox", "alert");
  expect(headers().get("authorization")).not.toBe(original);
  const calls = apple.mock.calls.length;
  for (const path of [
    "/v1/send",
    "/sandbox/3/device/xx",
    "/sandbox/3/device/aa/extra",
    "/other/3/device/aa",
  ]) {
    expect(
      (await worker.fetch(new Request(`https://relay.test${path}`, { method: "POST" }), env))
        .status,
    ).toBe(404);
  }
  expect(apple.mock.calls).toHaveLength(calls);
  const redirect = new Response(null, {
    status: 302,
    headers: { location: "https://not-apple.invalid" },
  });
  expect(await send("sandbox", "alert", redirect)).toBe(redirect);
});
