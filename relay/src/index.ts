// Forwards a Toy Box server's APNs request to Apple, signed with the iPhone app's key.
// README.md explains why the relay exists and how to deploy it.

/** The Worker's two secrets. The `.p8` key arrives already imported as an ES256 signing key. */
type RelayEnvironment = { APNS_KEY_ID: string; APNS_PRIVATE_KEY: CryptoKey };

// The only app this relay can reach: the Toy Box iPhone app under this Apple team.
const teamID = "RHFNBL7EG4",
  bundleID = "dev.toybox.mobile";

// The current APNs provider token, reused across requests by this Worker instance.
let cached: { key: CryptoKey; at: number; jwt: string } | undefined;

export default {
  async fetch(request: Request, env: RelayEnvironment): Promise<Response> {
    // 1. Accept only Apple's own send route, POST /{sandbox|production}/3/device/{hex token},
    //    so a server sends exactly the request it would send to Apple directly.
    const route = /^\/(sandbox|production)\/3\/device\/((?:[0-9a-fA-F]{2})+)$/.exec(
      new URL(request.url).pathname,
    );
    if (request.method !== "POST" || !route) return new Response(null, { status: 404 });

    // 2. Copy only Apple's `apns-*` headers, so the caller's own headers never reach Apple.
    const headers = new Headers();
    for (const [name, value] of request.headers) {
      if (name.startsWith("apns-")) headers.set(name, value);
    }

    // 3. Sign the request as the app, and pin its topic whatever the caller sent. Live Activity
    //    updates use the app's dedicated Live Activity topic.
    headers.set("authorization", `bearer ${await authorization(env)}`);
    headers.set(
      "apns-topic",
      bundleID +
        (headers.get("apns-push-type") === "liveactivity" ? ".push-type.liveactivity" : ""),
    );

    // 4. Stream the body to Apple's matching host without reading it, and return Apple's response
    //    as is, so the server sees Apple's status and reason. Never follow a redirect, which
    //    would carry the signed token somewhere else.
    const host = route[1] === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
    return fetch(`https://${host}/3/device/${route[2]}`, {
      method: "POST",
      headers,
      body: request.body,
      redirect: "manual",
    });
  },
};

/** Returns an APNs provider token: a JWT naming the key and team, signed with the app's key. */
async function authorization(env: RelayEnvironment): Promise<string> {
  // Apple rejects tokens older than an hour and refreshes more often than every 20 minutes,
  // so reuse each one for 50. A rotated key gets a new token on its first request.
  const now = Math.floor(Date.now() / 1000);
  if (cached?.key === env.APNS_PRIVATE_KEY && now - cached.at < 50 * 60) return cached.jwt;

  // JWT parts are unpadded base64url JSON.
  const base64url = (bytes: Uint8Array) =>
    bytes.toBase64({ alphabet: "base64url", omitPadding: true });
  const encode = (value: object) => base64url(new TextEncoder().encode(JSON.stringify(value)));

  // Sign `header.claims`. Web Crypto's ECDSA signature is already the raw form ES256 expects.
  const input = `${encode({ alg: "ES256", kid: env.APNS_KEY_ID })}.${encode({ iss: teamID, iat: now })}`;
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    env.APNS_PRIVATE_KEY,
    new TextEncoder().encode(input),
  );

  cached = {
    key: env.APNS_PRIVATE_KEY,
    at: now,
    jwt: `${input}.${base64url(new Uint8Array(signature))}`,
  };
  return cached.jwt;
}
