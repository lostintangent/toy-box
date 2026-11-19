#!/usr/bin/env bash
# Boots a built toy-box with an empty home and requires its web app to load.
set -euo pipefail
binary="$1"
port="${2:-3999}"
home="$(mktemp -d)"

if curl -s -o /dev/null "http://127.0.0.1:$port/"; then
  echo "Port $port is already serving" >&2
  exit 1
fi

HOME="$home" "$binary" --port "$port" --no-open >"$home/server.log" 2>&1 &
server=$!
cleanup() {
  kill "$server" 2>/dev/null && wait "$server" 2>/dev/null || true
  rm -rf "$home"
}
trap cleanup EXIT

status=000
for _ in $(seq 60); do
  status="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/" || true)"
  [ "$status" != 000 ] && break
  sleep 1
done
if [ "$status" != 200 ]; then
  echo "GET / returned $status" >&2
  cat "$home/server.log" >&2
  exit 1
fi
echo "GET / returned 200"
