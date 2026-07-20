# Toy Box Browser Extension

The browser extension lets users dispatch asynchronous tasks to Toy Box's Inbox from any webpage. Every task includes the page URL and the user's instructions, and can optionally include selected text and a screenshot of the visible viewport. This is useful for handing off work such as researching a topic, summarizing content, investigating a claim, or relating a page to local projects while the user keeps browsing and reviews the result later in the Inbox.

A user can compose a custom task from the toolbar or keyboard shortcut, or invoke a context-menu quick action. Every path submits one background task to `/api/inbox`; the extension does not observe or control the session after submission.

## Runtime boundaries

- `inbox.js` owns the shared submission contract: visible-viewport capture, prompt construction, screenshot attachment encoding, and the Inbox HTTP request. Both interactive and one-click flows converge here.
- `settings.js` owns the machine-local Toy Box server URL, normalization, Inbox endpoint construction, and optional host-permission lifecycle. `options/` is the only UI that mutates this setting.
- `ui.js` owns the two small DOM and error-display primitives shared by the popup and options page. Keep their distinct state and rendering logic with the page that owns it.
- `background.js` owns background execution: context-menu installation, direct quick actions, and transient badge feedback. Chromium runs it as a disposable service worker; Firefox and Safari can run the same module as a background script. Durable behavior must not depend on module globals or timers in either environment.
- `popup/` owns the toolbar and custom-prompt experience. It reads the active tab, acquires optional selection and screenshot context, renders the submission state, and closes after a successful send.
- `manifest.json` declares every runtime entry point, keyboard command, host, and permission. Keep its service-worker and background-script paths synchronized when files move.

The extension intentionally uses browser-native HTML, CSS, JavaScript modules, and WebExtension APIs without a build step or framework. Preserve that shape while the UI remains this small.

## Browser baseline

Use the native `browser.*` namespace without a polyfill. Chrome and Chromium expose it from version 148; the manifest enforces that minimum for Chromium browsers. Firefox and Safari expose it natively. This extension has no DevTools page, which is the Chrome exception that would disable the namespace.

The Manifest V3 background declaration intentionally includes both `service_worker` and `scripts`. Chromium 148+ ignores `scripts` and runs the service worker; Firefox 142+ and Safari can use the background-script fallback. Keep `background.js` valid in both contexts. The Gecko manifest block declares the active URL and optional page capture as `browsingActivity` and `websiteContent`; keep those declarations aligned with the data that submissions transmit to the user's Toy Box server.

## Submission flow

Every submission requires instructions and the active-page URL. Page title, selected text, and a visible-viewport JPEG are optional context. `inbox.js` turns those values into one prompt and sends the screenshot as Toy Box's base64 attachment representation. It asks `settings.js` for the complete Inbox endpoint immediately before dispatch; callers never assemble the endpoint themselves.

The toolbar, keyboard shortcut, and custom context-menu action open the popup. Quick actions submit immediately from the background runtime and report pending, success, or failure through the action badge.

## Invariants

- Call `browser.action.openPopup` directly inside the context-menu click listener, before any asynchronous boundary. Browsers treat it as a user-gesture-sensitive API and may reject deferred calls.
- Treat selection and viewport capture as optional. Script injection and screenshots are unavailable on protected browser pages and can fail without invalidating the page task.
- Send browser context only after an explicit toolbar, shortcut, or context-menu action. Avoid persistent page injection or broader host permissions without a concrete product requirement.
- Keep custom server access optional. Request only the configured HTTP or HTTPS host from a direct options-page user action, and release the previous optional host when the setting changes.
- Keep `inbox.js` aligned with the `/api/inbox` contract: JSON contains a non-empty `prompt` and optional base64 `attachments`.
- Keep popup state transitions explicit, keyboard-accessible, and compatible with light, dark, forced-color, and reduced-motion preferences.
- Request the narrowest browser permissions that support the current behavior. `activeTab` is preferable to persistent access to every page.

## Verification

After extension changes, reload the unpacked `browser` directory from the target browser's extension manager. Verify the toolbar popup, keyboard shortcut, custom context-menu popup, both direct quick actions, selection removal, screenshot removal, success close, and failure feedback. Changes to manifest paths or background gesture handling require a fresh extension reload, not only reopening the popup.

Run the repository formatting, linting, typecheck, and test commands before handoff.
