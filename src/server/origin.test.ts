import { expect, test } from "bun:test";
import { H3 } from "h3";
import refuseCrossSiteWrites, { isTrustedOrigin } from "./middleware/origin";

const request = (origin?: string, method = "POST", host = "localhost:3100") =>
  new Request(`http://${host}/api/v1/inbox`, {
    method,
    headers: origin ? { origin } : {},
  });

test("Toy Box trusts its own pages, browser extensions, and non-browser clients", () => {
  expect(isTrustedOrigin(request("http://localhost:3100"))).toBe(true);
  expect(isTrustedOrigin(request("https://localhost:3100"))).toBe(true);
  for (const extension of ["chrome-extension", "moz-extension", "safari-web-extension"])
    expect(isTrustedOrigin(request(`${extension}://toy-box`))).toBe(true);
  expect(isTrustedOrigin(request())).toBe(true);
  expect(isTrustedOrigin(request("https://unrelated.example"))).toBe(false);
  expect(isTrustedOrigin(request("http://localhost:3101"))).toBe(false);
  expect(isTrustedOrigin(request("null"))).toBe(false);
});

test("a cross-site page can read but not write", async () => {
  const app = new H3().use(refuseCrossSiteWrites).all("/**", () => "handled");
  const write = await app.fetch(request("https://unrelated.example"));
  expect(write.status).toBe(403);
  expect(await write.json()).toEqual({ error: "Cross-site requests are refused." });

  const read = await app.fetch(request("https://unrelated.example", "GET"));
  expect(await read.text()).toBe("handled");
});

test.each([
  "localhost:3100",
  "app.localhost:3100",
  "127.0.0.1:3000",
  "192.168.1.20:3000",
  "100.64.0.1:3000",
  "[::1]:3100",
  "[fd00::1]:3000",
  "mac.tailnet.ts.net",
  "mac.tailnet.ts.net:8443",
])("accepts local and Tailscale access through %s", async (host) => {
  const app = new H3().use(refuseCrossSiteWrites).all("/**", () => "handled");
  expect(isTrustedOrigin(request(`https://${host}`, "GET", host))).toBe(true);
  expect((await app.fetch(request(undefined, "GET", host))).status).toBe(200);
  expect((await app.fetch(request(`https://${host}`, "POST", host))).status).toBe(200);
});

test.each([
  "attacker.example:3100",
  "localhost.attacker.example",
  "mac.tailnet.ts.net.attacker.example",
  "notts.net",
])("refuses %s even with matching, absent, or extension Origins", (host) => {
  for (const origin of [`http://${host}`, undefined, "chrome-extension://toy-box"])
    expect(isTrustedOrigin(request(origin, "GET", host))).toBe(false);
});

test.each(["GET", "HEAD", "OPTIONS", "POST"])(
  "refuses a rebound %s before its handler",
  async (method) => {
    const app = new H3().use(refuseCrossSiteWrites).all("/**", () => "handled");
    const response = await app.fetch(
      request("http://attacker.example:3100", method, "attacker.example:3100"),
    );
    expect(response.status).toBe(403);
  },
);
