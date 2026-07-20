# 🧸 Toy Box

Toy Box is a self-hosted agent server for running agentic tasks from anywhere. It includes an easy-to-use web app for starting, observing, and controlling sessions from both your desktop and phone while keeping all connected clients synchronized.

Beyond simple session management, Toy Box provides several helpful workflows that make everyday tasks simpler: scheduled automations, editable artifacts, child session orchestration, an Inbox for asynchronous tasks, and an integrated terminal.

<img width="1000" src="https://github.com/user-attachments/assets/7964dab2-ca7c-4bc4-8e00-cbb85afa9c8b" />

## Features

- **Real-time sessions:** Start or resume work and watch responses, reasoning, tool calls, and progress stream in while queuing follow-ups during a run.
- **Rich composer:** Choose the model and reasoning effort, attach images, invoke skills, dictate by voice, and start sessions in a working directory or isolated Git worktree.
- **Multi-pane workspace:** Open up to four sessions, artifacts, or agent-provided canvases together, with live previews and an adaptive mobile layout.
- **Multi-agent orchestration:** Delegate parallel work to child sessions and use the floating Hyper workspace for a dedicated orchestration thread.
- **Cross-device sync:** Install Toy Box as a PWA and keep real-time session status—including running and unread—synchronized across every connected desktop and mobile client.
- **Bidirectional artifacts:** Agent changes appear in editable Markdown, HTML, and SVG views, while your edits are saved to disk and notify the agent; custom viewers can support other formats.
- **Focused Inbox:** Dispatch asynchronous tasks from Toy Box or directly from any webpage with the browser extension, then get notified when concise results and editable artifacts are ready.
- **Scheduled automations:** Configure recurring prompts that automate routine work and produce reviewable artifacts such as reports, analyses, and news digests.
- **Integrated terminal:** Run shell commands from a configurable terminal that works on your desktop and phone and reconnects seamlessly without losing your scrollback.

## Getting Started

1. Install the Copilot CLI and authenticate with your GitHub account
1. Install Toy Box globally: `npm install -g @lostintangent/toy-box`
1. Start it in any directory: `toy-box <path>`

## Developing

1. Clone this repo
1. Run `bun install`
1. Run `bun dev`
