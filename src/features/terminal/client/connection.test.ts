import { expect, test } from "bun:test";
import { installFakeSockets } from "@/shared/testFixtures";
import { TerminalConnection } from "./connection";

test("sends input typed before the socket opens as soon as it does", () => {
  const { socket, connection } = createHarness();
  connection.open();
  connection.send("l");
  connection.send("s\r");

  socket().accept();

  expect(socket().sent).toEqual(["ls\r"]);
});

test("sends a resize made while the socket connects as soon as it opens", () => {
  const { socket, connection } = createHarness();
  connection.open();
  connection.resize(100, 30);

  socket().accept();

  expect(socket().sent).toEqual([{ type: "resize", cols: 100, rows: 30 }]);
});

test("reconnects as soon as input arrives while the socket is down", () => {
  const { sockets, socket, connection } = createHarness();
  connection.open();
  socket().accept();
  socket().drop();

  connection.send("x");
  expect(sockets).toHaveLength(2);

  socket().accept();
  expect(socket().sent).toEqual(["x"]);
});

test("stays closed after another tab replaces its socket", () => {
  const { sockets, socket, connection, runTimers } = createHarness();
  connection.open();
  socket().accept();

  socket().drop(4000);
  runTimers();

  expect(sockets).toHaveLength(1);
});

test("drops held input when closed", () => {
  const { socket, connection } = createHarness();
  connection.open();
  connection.send("make\r");
  connection.close();

  connection.open();
  socket().accept();

  expect(socket().sent).toEqual([]);
});

function createHarness() {
  return {
    ...installFakeSockets(),
    connection: new TerminalConnection({
      params: () => ({ clientId: "tab-1", cols: 80, rows: 24 }),
      onData: () => {},
      onMessage: () => {},
      onClose: () => {},
    }),
  };
}
