## 📅 v0.4.4 (11/13/26)

- Server discovery is now built on top of Tailscale directly, as opposed to via a seperate linked/peer server system. Tailscale is still optional, but it's now required for multi-server setups (along with `tailscale serve`).

## 📅 v0.4.3 (11/13/26)

- When collapsed, the sidebar now shows running/waiting/finished channels
- The server now automatically updates itself and then displays a dot in the settings icon when a restart is available.

## 📅 v0.4.2 (11/13/26)

- Servers can now be restarted even if there isn't an available update

## 📅 v0.4.1 (11/12/26)

- Linked servers now show their name and version in the `Settings` dialog

## 📅 v0.4.0 (11/12/26)

- You can now link servers together, which allows channel leads to discover and message each other across machines
- The server now allows detecting and applying updates, which can be triggered from either the web client or the iOS/macOS clients
- You can now open arbitrary files from the file browser and see them displayed via a syntax-highlighted/read-only viewer
- Channels can now define custom avatars, which are displayed in the `Channels` sidebar panel, and in the sidebar of the iOS/macOS clients

## 📅 v0.3.9 (11/11/26)

- If you reconnect to a running session (e.g. your laptop wakes up), it now picks up exactly where it left off, instead of occasionally missing part of a reply or a queued message
- Opening sessions is lighter: reopening one you've already loaded no longer re-downloads its transcript, and opening a running session takes one request instead of three
- When you stop a session, every other tab and device watching it now shows the same result
- Codex sessions no longer briefly hide the message you just sent, and sending to an idle Codex session no longer replays its whole history first
- Channels now send less while agents work, since each client works out who's working and waiting from the agents' live sessions

## 📅 v0.3.8 (11/10/26)

- The Toy Box web client now loads faster, especially on your phone.
- Very large sessions now open reliably. Long sessions load their latest messages first, and load earlier ones as you scroll up.
- If a session loses its connection mid-turn, it now picks up where it left off, instead of freezing until the turn ends
- If a message fails to send (in a session or a channel), it's now restored to the composer instead of being lost
- Open sessions now recover on their own after the server restarts, and your Hyper session stays your Hyper session across restarts
- Codex subagents can now use Toy Box's tools, instead of having their calls declined
- Deleting a session whose history was already removed outside Toy Box now succeeds, instead of failing with "not found"
- Live updates for sessions and channels are now compressed, which makes them much lighter over slow connections (e.g. your phone)
- Channel attachments are now more reliable, since they're stored with the channel, and keep working even if their original file is moved or deleted. This also makes channels lighter to load, and deleting a channel now deletes its attachments.
- The channel list now includes each channel's pending request, so the iOS/macOS apps can show what's waiting on you without downloading message history
- Custom file editors are now apps. An app can declare the file types it opens (e.g. `.http`), and those files then open in it, so there's one way to build an editor.
- Images and videos now preview in file panes. Files that aren't text (e.g. PDFs or archives) show "This file isn't text" instead of opening as garbled, editable text, so they can't be accidentally overwritten.
- If an agent changes a file while you're typing in it, your pending save no longer overwrites the agent's change
- When a file switches to a different editor (e.g. after installing an app that opens it), the new editor starts from your latest edits instead of the last save
- Files opened in a browser tab now use their real type, so PDFs, audio, CSV and Markdown files display instead of downloading
- The Channels and Automations sidebar sections are now always visible, even when empty, so you can create your first one from there

## 📅 v0.3.7 (11/06/26)

- Channels now support bookmarking messages, so you can keep track of ones you want to revisit.
- The command palette has a new `Ready for you` section that surfaces the sessions, channels, and automations that are waiting on you (e.g. pending question, unread, finished task list)
- Channels and automations in the command palette now show the same live status as the sidebar (e.g. waiting, running, finished)
- Automations whose provider is disabled are now hidden from the sidebar, instead of closing immediately when opened

## 📅 v0.3.6 (11/05/26)

- Channel leads can now communicate with each other via private messages
- The server now exposes screens to external clients, which enables the iOS/macOS apps to consume them.
- The command palette has been improved in the following ways:
  - There's a new `This ...` section at the top which provides common actions for the currently selected pane
  - When navigating channels, apps, or automations, you can now access their actions and/or add them to the workspace.
- When you browse for a file or a screen, a selection will open an existing pane if applicable

## 📅 v0.3.5 (11/01/26)

- Channel lead's can now include a set of pre-defined replies when they request your attention
- Artifacts can now be removed from a channel (either by you or the lead)
- Channel leads can now edit and remove channel members
- Parent tasks in a channel are now auto-collapsed by default unless they have in-progress children
- Installed-but-unautheticated providers will correctly show as disabled

## 📅 v0.3.4 (10/28/26)

- The file browser now shows gitignored files/folders as muted
- Added push notification support to the server to enable the new iOS app to recieve notifications about lead requests and completed channels
- Only one session artifact is auto-opened at a time and you can open others by selecting them

## 📅 v0.3.3 (10/26/26)

- The channel overview now allows collapsing sections (e.g. `Team`, `Tasks`, etc.)
- Channel tasks now track and display how long an in-progress task has been running, and a lead can set a "check-in time" on a task.
- Channel members can now set a wait timeout when finishing a turn (like the lead always could)
- The channel task list can now be filtered to in progress items only. The team list can also be filtered in running members only

## 📅 v0.3.2 (10/21/26)

- Introduced a command palette for automating common tasks
- Added a session view mode, which allows focusing sessions to just responses, and therefore, hiding tool calls and agent reasoning.
- Add running times + scheduled check-ins for in-progress channel tasks.

## 📅 v0.3.1 (10/20/26)

- The session composer now shows a context meter when the context window is >50% used
- Session providers now display your plan and usage in the settings dialog
- Sessions/channel members now have the notion of "backgrounded"

## 📅 v0.3.0 (10/13/26)

- Added support for desktop/screen sharing
- Copilot and Codex sessions/channels now support image generation (Claude doesn't)
- You can now @mention sessions from a session
- Child sessions now appear in the sidebar
- The channel checklist now displays associated diffs and artifacts for items
- Channel attachments now support videos (in addition to images)
- Channels can now be filtered to just your messages
- Channels and the inbox now persist/sync draft messages

## 📅 v0.2.0 (09/22/26)

- Introduced support for Codex and Claude-based sessions
- Re-designed the session composer
- Added an overview pane/sheet to channels
- SVG/whiteboard files now support pinch-to-zoom
- Added new tools for sessions/agents to search and read sessions
- Added a customized "ink cloud" to the channel and inbox panes

## 📅 v0.1.20 (09/08/26)

- Introduced the notion of agents and channels
- Added an "ink cloud" to draft sessions and an ink-splatter typing effect to the session composer
- The skill picker and skill tool call now allow opening the `SKILL.md` directly in an editor pane
- Artifact pills in a session now show when a file has active workers running
- _(Engineering)_ Migrate shared interface primitives from Radix UI to Base UI

## 📅 v0.1.19 (08/26/26)

- Add support for configuring the context window
- The artifacts list is now scoped to common file types

## 📅 v0.1.18 (08/21/26)

- Introduced the concept of "intent board" artifacts
- Added support for user input questions
- Qeueued messages can now be sent immediately ("steering")

## 📅 v0.1.17 (08/14/26)

- Added support for session-scoped apps (`.toy` artifacts)
- Queued messages now display attachments

## 📅 v0.1.16 (08/06/26)

- The sidebar can now be collapsed while retaining access to common actions

## 📅 v0.1.15 (08/05/26)

- Added initial support for custom apps

## 📅 v0.1.14 (07/21/26)

- Introduce support for "hyper sessions"
- Draft prompt values are no synced with the server
- Added inbox + chrome extension to send async tasks to it
- Allow sending queued mesages immediately by long-pressing them

## 📅 v0.1.13 (07/02/26)

- Add initial support for artifact panes (markdown and HTML)

## 📅 v0.1.12 (06/21/26)

- Add initial support for canvas panes
- Fixed misc. bugs related to tool calls/automaations

## 📅 v0.1.11 (06/12/26)

- Added support for GPT-based edit tool calls

## 📅 v0.1.10 (06/10/26)

- Introduced agent tools for creating and editing automations
- Added support for configuring reasoning effort
