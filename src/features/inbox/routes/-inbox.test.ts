import { expect, onTestFinished, spyOn, test } from "bun:test";
import * as inbox from "../server/functions";
import { Route } from "./inbox";

const receipt = { sessionId: "accepted-task" };

function acceptTask() {
  const dispatch = spyOn(inbox, "dispatchInboxTask").mockResolvedValue(receipt);
  onTestFinished(() => dispatch.mockRestore());
  return dispatch;
}

async function post(init: RequestInit) {
  const handlers = Route.options.server!.handlers!;
  if (typeof handlers === "function" || !handlers.POST) {
    throw new Error("Inbox route must handle POST requests.");
  }
  const response = await handlers.POST({
    request: new Request("http://toy-box.test/api/inbox", { ...init, method: "POST" }),
    context: undefined,
    params: {},
    pathname: "/api/inbox",
    next: () => {
      throw new Error("Inbox requests must be handled by the Inbox route.");
    },
  });
  if (!(response instanceof Response)) {
    throw new Error("Inbox route must return a response.");
  }
  return response;
}

test("JSON submissions admit the prompt and attachments and return the task identity", async () => {
  const dispatch = acceptTask();
  const attachments = [{ mimeType: "image/png", base64: "AAEC" }];
  const response = await post({
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: "Research this", attachments }),
  });

  expect(dispatch).toHaveBeenCalledWith({
    data: { message: { content: "Research this", attachments } },
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual(receipt);
});

test("multipart uploads use the explicit prompt and convert images into attachments", async () => {
  const dispatch = acceptTask();
  const body = new FormData();
  body.set("prompt", "Summarize this");
  body.set("transcription", "Fallback transcription");
  body.append(
    "attachments",
    new File([new Uint8Array([0, 1, 2])], "page.png", { type: "image/png" }),
  );
  body.append(
    "attachments",
    new File([new Uint8Array([3, 4, 5])], "photo.jpg", { type: "image/jpeg" }),
  );
  const response = await post({ body });

  expect(dispatch).toHaveBeenCalledWith({
    data: {
      message: {
        content: "Summarize this",
        attachments: [
          { mimeType: "image/png", base64: "AAEC" },
          { mimeType: "image/jpeg", base64: "AwQF" },
        ],
      },
    },
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual(receipt);
});

test("transcription-only submissions admit text without attachments", async () => {
  const dispatch = acceptTask();
  const body = new FormData();
  body.set("transcription", "Research this");
  const response = await post({ body });

  expect(dispatch).toHaveBeenCalledWith({
    data: { message: { content: "Research this", attachments: undefined } },
  });
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual(receipt);
});

test.each([
  { name: "malformed JSON", contentType: "application/json", body: "{" },
  { name: "missing prompt", contentType: "application/json", body: "{}" },
  { name: "unsupported content type", contentType: "text/plain", body: "Research this" },
])(
  "invalid submissions ($name) return 400 without admitting work",
  async ({ contentType, body }) => {
    const dispatch = acceptTask();
    const response = await post({ headers: { "Content-Type": contentType }, body });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: expect.any(String) });
    expect(dispatch).not.toHaveBeenCalled();
  },
);
