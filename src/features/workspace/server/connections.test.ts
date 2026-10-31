import { expect, mock, test } from "bun:test";
import { attachToConnection, closeConnection, openConnection, releaseLease } from "./connections";

test("closing a connection releases everything still attached to it", () => {
  const connection = openConnection();
  const first = mock(() => {});
  const second = mock(() => {});
  attachToConnection(connection, first);
  attachToConnection(connection, second);

  closeConnection(connection);

  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
});

test("a lease released early is not released again when its connection closes", () => {
  const connection = openConnection();
  const release = mock(() => {});
  const lease = attachToConnection(connection, release)!;

  releaseLease(connection, lease);
  closeConnection(connection);

  expect(release).toHaveBeenCalledTimes(1);
});

test("attaching to a closed connection releases immediately", () => {
  const connection = openConnection();
  closeConnection(connection);
  const release = mock(() => {});

  expect(attachToConnection(connection, release)).toBeUndefined();
  expect(release).toHaveBeenCalledTimes(1);
});
