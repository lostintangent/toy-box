# Push

Push owns one install registration and its opaque topic subscriptions. Registrations supply the
APNs environment and default device token. An optional subscription token and original Unix
`startedAt` address a Live Activity. SQLite cascades install removal to its subscriptions.
Request paths carry identities, never JSON bodies. Unknown installs cannot subscribe.

`publish(topic, eventOrFactory)` is inert without subscribers. Channels owns notification eligibility,
the three-second unread check, and timeless Activity content. Push owns relay delivery, pruning and
first/last-topic interest. A future feature publishes its own event and observes its own topic names.

One serial queue owns reload and delivery. A five-minute tick reloads and refreshes all topics.
One 100ms debounce coalesces current updates. Endings and attention identities that differ from the
last delivered update use priority 10, all other changes priority 5. Subscribing an Activity token
clears that topic's history and arms immediate catch-up.
The eight-hour limit is checked on reload, so expiry can lag by one tick. Unchanged refreshes arrive
within ten minutes, before the fifteen-minute stale date.

Alerts make one attempt. Any successful Activity advances its topic's delivery history, so one
failing install cannot spend a healthy Activity's request-priority budget. If every send fails,
the next publication or tick retries. Otherwise, failures retry on content changes or eligible ticks.
Any `410`, including `Unregistered` and `ExpiredToken`, and `400 BadDeviceToken` prune tokens.
Authentication failures never remove
subscriptions. A successful end deletes only its matching token, preserving an in-flight replacement.
All delivery state is process-local and best-effort; registration/subscription rows survive restart.

Every server sends through `https://toy-box-push-relay.lostintangent.workers.dev`, with no Apple
key or required settings. `TOY_BOX_PUSH_RELAY_URL` optionally selects another relay base URL.
The sender builds Apple's headers and payload at `/{environment}/3/device/{token}` on that relay.
The relay adds only its credential and pinned topic, returning Apple's response unchanged.
Relay failures are 404 or Cloudflare's 5xx, never token-pruning reasons. Transport errors stay failures, not deliveries.
Alerts carry display-ready channel names and request/completion text, the requester's Reply handle,
and registration-qualified channel threads. Their text and Live Activity content pass through the
relay and Apple without application-level encryption, as approved by the user. The relay streams
the body without parsing or logging it, and observability is disabled. Only the relay operator
supplies Apple signing credentials. The phone service checks registration and requests a widget
reload, without fetching notification content.

`publishBadge(topics, countFactory)` uses the same serial queue and stays lazy without eligible alert subscribers.
Channels supplies its existing catalog's waiting-channel count. The runtime retains the badge source
independently of the consumer because feature startups run concurrently. Starting or replacing Push
installs that source before subscriptions load. Only badge-only pushes carry `aps.badge`, including
zero, without sound, alert or `content-available`. Alerts never carry a count or acknowledge badge
delivery, so an alert delayed by the phone's notification service cannot restore an older count.
Deduplicate notification topics by registration/environment/device token, excluding Live Activities.
Turning both notification topics off therefore stops badge pushes. Re-read persisted subscriptions
after resolving the count so an opt-out during that work cannot restore a badge. Successful counts
are process-local per-address history. Failures stay unacknowledged and catch up on the next
publication, subscription reload or existing five-minute tick, using normal token pruning.
