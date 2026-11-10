import { expect, test } from "bun:test";
import { connectSocket } from "./socket";
import { installFakeSockets } from "./testFixtures";

test("each socket's URL names its service and the params current as it connects", () => {
  const fake = installFakeSockets();
  let size: { cols: number; rows?: number } = { cols: 80 };
  connectSocket("terminal", { params: () => ({ clientId: "tab-1", ...size }), onMessage() {} });

  fake.socket().drop();
  size = { cols: 100, rows: 30 };
  fake.runTimers();

  expect(fake.sockets.map((socket) => socket.url.href)).toEqual([
    "ws://localhost:3100/socket?service=terminal&clientId=tab-1&cols=80",
    "ws://localhost:3100/socket?service=terminal&clientId=tab-1&cols=100&rows=30",
  ]);
});

test("retries back off until the server speaks, not merely until a socket opens", () => {
  const fake = installFakeSockets();
  connectSocket("screens", { onMessage() {} });

  for (let attempt = 0; attempt < 8; attempt++) {
    fake.socket().accept();
    fake.socket().drop();
    fake.runTimers();
  }
  fake.socket().accept();
  fake.socket().receive("{}");
  fake.socket().drop();

  expect(fake.delays).toEqual([250, 500, 1000, 2000, 4000, 8000, 10_000, 10_000, 250]);
});

test("a service can decline a retry and connect again when it chooses", () => {
  const fake = installFakeSockets();
  const socket = connectSocket("terminal", { onMessage() {}, onClose: () => false });

  fake.socket().drop(4000);
  fake.runTimers();
  expect(fake.sockets).toHaveLength(1);

  socket.reconnect();
  expect(fake.sockets).toHaveLength(2);
});

test("closing is final", () => {
  const fake = installFakeSockets();
  let closes = 0;
  const socket = connectSocket("screens", { onMessage() {}, onClose: () => void closes++ });
  fake.socket().accept();

  socket.close();
  socket.reconnect();
  fake.runTimers();

  expect([fake.sockets.length, closes, socket.send("late")]).toEqual([1, 0, false]);
});
