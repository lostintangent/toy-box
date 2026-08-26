# 🧸 Toy Box

Toy Box is a self-hosted agent server for running agentic tasks from anywhere. It includes an easy-to-use web app for starting, observing, and controlling sessions from both your desktop and phone while keeping all connected clients synchronized.

Beyond simple session management, Toy Box provides several helpful workflows that make everyday tasks simpler: scheduled automations, editable artifacts, child session orchestration, generative apps, and an inbox for asynchronous tasks, and an integrated terminal.

<img width="1000" src="https://github.com/user-attachments/assets/7964dab2-ca7c-4bc4-8e00-cbb85afa9c8b" />

## Features

- **Live, multi-device sessions:** Start or resume work from desktop or mobile, watch and steer it from every connected client, answer agent questions, manage queued follow-ups, and pin important sessions.
- **Rich composer:** Choose the model and reasoning effort, attach images, invoke skills, dictate by voice, and start sessions in a working directory or isolated Git worktree.
- **Multi-pane workspace:** Open up to four sessions, local files, artifacts, apps, terminals, or agent-provided canvases together, with live previews and an adaptive mobile layout.
- **Multi-agent orchestration:** Delegate parallel work to child sessions and use the floating Hyper workspace for a dedicated orchestration thread.
- **Collaborative artifacts:** Browse and edit Markdown, HTML, JSON, and SVG alongside the agent, or use structured intent boards to review and launch consequential work.
- **Toy Box apps:** Build session-scoped `.toy` React artifacts or install reusable, stateful apps from trusted GitHub Gists. Apps can compose sessions, files, panes, workers, and shared content.
- **Scheduled automations:** Configure recurring prompts that automate routine work and produce reviewable artifacts such as reports, analyses, and news digests.
- **Inbox and webhooks:** Dispatch background tasks from Toy Box, webpages, mobile voice capture, or any HTTP client, then review concise results and editable artifacts in one place.

## Getting Started

1. Install the Copilot CLI and authenticate with your GitHub account
1. Install Toy Box: `npm install -g @lostintangent/toy-box`
1. Start the agent server: `toy-box`
1. Open `http://localhost:3000` in your browser

## Access From Anywhere

In order to access Toy Box from your phone (or other machines), simply configure [Tailscale](https://tailscale.com/) on the desired devices, enable MagicDNS and HTTPS for your tailnet, start Toy Box (`toy-box`), then run:

```sh
tailscale serve --bg http://127.0.0.1:3000
```

You can then open the provided https://<machine>.<tailnet>.ts.net/ URL from any device on the same tailnet as the Toy Box server. After opening this URL in your mobile browser, you can install it to your home screen by doing the following:

| Mobile platform     | Install Step(s)                                |
| ------------------- | ---------------------------------------------- |
| iOS (iPhone / iPad) | Use Safari's Share → Add to Home Screen        |
| Android             | Use Chrome's Install app or Add to Home screen |

> ⚠️ Toy Box has no app-level authentication. Keep it behind Tailscale Serve and tailnet access controls; do not expose it publicly with Funnel.

## Inbox Webhook

With that private HTTPS URL in place, Toy Box's inbox can accept external tasks by means of simply sending a `POST` to the following URL: `https://<toy-box-host>/api/inbox`.

```sh
curl -X POST "https://<toy-box-host>/api/inbox" \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Summarize the latest changes and send the result to my Inbox."}'
```

The webhook supports both JSON and multipart form data:

| Payload type | Expected payload data                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| JSON         | A non-empty `prompt`, with optional base64 `attachments` containing `displayName`, `mimeType`, and `base64` |
| Form data    | `prompt` or `transcription`, with optional files using the field name `attachments`                         |

The same endpoint works with several ready-made integrations:

- **Browser extension:** Follow [`browser/README.md`](browser/README.md), then set its server URL to the Toy Box base URL without `/api/inbox`. It can include the current page, selected text, and a viewport screenshot, with toolbar, shortcut, and context-menu actions.
- **Pebble Index 01:** In CoreApp, open **Index Settings → Webhook**, use the full Inbox URL, and choose **Transcription only**. Toy Box accepts CoreApp's `transcription` field directly; no auth token is required.
- **QuickCast Hook:** Install it from the [App Store](https://apps.apple.com/us/app/quickcast-hook/id6756369952), then create a `POST` multipart webhook using the full Inbox URL. Enable on-device transcription, name its field `transcription`, and use `attachments` as the file field when sending audio or images.

## Developing

1. Clone this repo
1. Run `bun install`
1. Run `bun dev`
