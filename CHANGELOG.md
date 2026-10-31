## 📅 v0.3.5 (10/30/26)

- Installed-but-unautheticated providers will correctly show as disabled
- Improved CLI upgrade experience, by allowing your existing SQLite databases to be migrated as the schema changes

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
