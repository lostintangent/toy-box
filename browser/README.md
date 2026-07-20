# Toy Box browser extension

This unpacked Manifest V3 extension sends the current page, its visible viewport, an optional text selection, and your prompt to a configurable Toy Box Inbox endpoint.

The server defaults to `http://localhost:3100`. Open **Server settings** from the popup—or the extension's options page—to use another HTTP or HTTPS server. Enter only the server base URL; the extension always appends `/api/inbox`. The setting is local to the current browser profile so a machine-specific Toy Box address is not synced elsewhere.

## Compatibility

The source uses the native `browser.*` WebExtension namespace without a polyfill:

- Chrome, Arc, Edge, and other Chromium browsers require Chromium 148 or newer.
- Firefox 142+ and Safari expose `browser.*` natively. The manifest includes a background-script fallback because Firefox does not run Manifest V3 extension service workers.
- Safari Web Extensions require Apple's Xcode conversion and packaging flow; the unpacked-directory steps below apply to Chromium browsers and Firefox.

The default localhost host permission is installed with the extension. A custom server is requested as an optional host permission only when you save it, and the previous custom host permission is released when the server changes.

## Install in a Chromium browser

1. Start Toy Box with `bun dev`.
2. Open the browser's extension manager, such as `chrome://extensions`, `arc://extensions`, or `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked** and select this `browser` folder.
5. Optionally pin **Toy Box** to the toolbar.

For temporary Firefox testing, open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `manifest.json` from this folder.

## Use

Select text on any page if it is relevant, open the extension, enter a task, and choose **Send**. The extension also works without a selection and always includes the current page URL. A viewport thumbnail shows the screenshot that will be attached; remove it from the prompt with its × button.

Open the same prompt with **Command+Shift+Y** on macOS or **Ctrl+Shift+Y** elsewhere. Chromium browsers reserve Command/Ctrl+Shift+T for reopening closed tabs. Shortcuts can be changed from the browser's extension shortcut settings.

The page context menu contains **Send to Toy Box**, with actions for a custom prompt, summarizing the page, or researching how the page applies to recent local projects. The latter two submit directly to the Inbox and briefly show success or failure on the extension badge.

The extension uses browser-native Manifest V3 APIs and has no build step. The toolbar popup is colocated in `popup/`; `settings.js` owns server resolution; and `inbox.js` owns the shared prompt, screenshot, and Inbox request contract used by both the popup and context-menu quick actions.
