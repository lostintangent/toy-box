# Toy Box Push Relay

This is a tiny Cloudflare Worker that lets any Toy Box server send push notifications to Toy Box mobile.

**Why it's needed:** every Toy Box server is self-hosted, but they all push to the same iPhone app. Apple only accepts those pushes when they're signed with the app's private key, and that key can't
be given to every server. So pushes need one trusted, hosted proxy to Apple.

**What it does:** the relay is that proxy. It holds the iPhone app's Apple key, and your server
hands it each notification to sign and send to Apple on your server's behalf. Servers use it
automatically, with no Apple account, key or setup of their own.

## How it works

Servers send Apple's exact request to `https://toy-box-push-relay.lostintangent.workers.dev`, at
`POST /{sandbox|production}/3/device/{token}`. The relay then:

1. Keeps only the `apns-*` headers, so the caller's own auth and other headers never reach Apple.
2. Adds a signed APNs token and pins `apns-topic` to `dev.toybox.mobile`, or its Live Activity
   topic. The relay can't push to any other app.
3. Streams the body to Apple's sandbox or production host and returns Apple's response unchanged.

It's stateless. There's no database, queue or rate limit, and logging is off, because the device
token in the path is the credential. The server owns payloads, expiration and dropping tokens Apple
rejects. Alerts carry display-ready channel names and request/completion text, along with routing
and Reply handles, and badge pushes carry only the count. The phone does not fetch alert content. Live Activity updates also carry
channel names and task counts. This content passes through the relay and Apple without
application-level encryption, as approved by the user. The relay does not parse or log the body.

## Deployment

Workers Builds deploys the relay whenever a push to `main` changes `relay/`. It runs `bun run test`
and then `bun run deploy` in this folder, so a failing test stops the deploy. Each build shows as a
check on its GitHub commit, with logs under the Worker's Deployments in the Cloudflare dashboard.

To set the relay up in a new Cloudflare account, deploy it once by hand:

```sh
bun install --frozen-lockfile
bun run deploy
```

That creates the Worker. Then set its two secrets once. The `.p8` key travels only through stdin:

```sh
cf workers secrets update APNS_KEY_ID --worker toy-box-push-relay --type secret_text --text YOUR_KEY_ID
node --input-type=module -e '
  import { readFileSync } from "node:fs";
  const pem = readFileSync(process.argv[1], "utf8");
  process.stdout.write(JSON.stringify({
    name: "APNS_PRIVATE_KEY", type: "secret_key", format: "pkcs8",
    algorithm: { name: "ECDSA", namedCurve: "P-256" }, usages: ["sign"],
    key_base64: pem.replace(/-----[^-]+-----|\s/g, "")
  }));
' /path/to/Key.p8 | cf workers secrets update APNS_PRIVATE_KEY --worker toy-box-push-relay --body @/dev/stdin
```

Finally, connect this repo under the Worker's Settings › Build, with branch `main`, root directory
`relay`, build command `bun run test`, deploy command `bun run deploy` and watch path `relay/*`.

Later deploys keep both secrets. To rotate the key, rerun both commands with the new key, check
that a real push arrives, then revoke the old key in Apple's developer portal. The app and servers
don't change.

The team ID (`RHFNBL7EG4`) and bundle ID are constants in `src/index.ts`. A relay under another
Apple team only works with a phone app built under that team.

## Development

`bun test` runs the handler's tests against a mocked Apple. The repo root's `bun test` and
`bun run check` include them too, without installing the relay's dependencies.

A local server uses the deployed relay by default, so you don't need to run the relay to work on
push. Local `cf dev` can't reach Apple, because local workerd lacks outbound HTTP/2. To try a relay
change against real APNs before deploying it:

1. Run `cf workers versions create --preview-alias candidate`.
2. Point your dev server's `TOY_BOX_PUSH_RELAY_URL` at that version's preview URL.
3. Send a push to your own phone. Preview versions share the production secrets, so use only your
   own device.
4. Merge it to `main`, which deploys it.
