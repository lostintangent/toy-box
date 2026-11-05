import { expect, test } from "bun:test";
import { isSocketOrigin } from "./socket";

test("the socket gateway admits same-origin browsers and native clients", () => {
  const request = (origin?: string) =>
    new Request("http://localhost:3100/socket?service=screens", {
      headers: origin ? { origin } : {},
    });
  expect(isSocketOrigin(request("http://localhost:3100"))).toBe(true);
  expect(isSocketOrigin(request("https://localhost:3100"))).toBe(true);
  expect(isSocketOrigin(request("https://unrelated.example"))).toBe(false);
  expect(isSocketOrigin(request("null"))).toBe(false);
  expect(isSocketOrigin(request())).toBe(true);
});
