# 🧸 Toy Box

<img width="1000" src="https://github.com/user-attachments/assets/7964dab2-ca7c-4bc4-8e00-cbb85afa9c8b" />

## Features

1. Start + resume agentic coding sessions against your local dev box
1. CMD+click sessions to open a grid of sessions (up to 4)
1. Sessions track in-progress/unread state, which is synced across all clients
1. Integrated terminal allows running shell commands as needed
1. PWA/responsive layout makes working on sessions from your phone a breeze
1. Automated sessions allow you to schedule recurring tasks

## Getting Started

1. Install the Copilot CLI and authenticate with your GitHub account
1. `cd` into the project directory you want to work on remotely
1. Run `npx @lostintangent/toy-box` (or `bunx @lostintangent/toy-box`)
1. Start running agentic tasks on your machine 🚀

If you'd also like to be able to access your toy box server from your phone and/or other devices, then simply setup [Tailscale](https://tailscale.com/) and access the UI via `http://<machine-ip-or-dns-name>:3000`.

> Note: You can also install the Toy Box CLI globally and run it via `toy-box`.

## Developing

1. Clone this repo
1. Run `bun install`
1. Run `bun dev`
