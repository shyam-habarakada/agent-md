# agent.md Specification

**Version:** 0.1.0  
**Status:** Draft Proposal  
**Authors:** Open proposal — contributions welcome

---

## Overview

`agent.md` is a convention for web applications to expose a structured, human+machine-readable contract at a well-known URL (`/agent.md`). It describes what the app does and declares a set of JavaScript functions that any authorized agent can discover and invoke — without scraping HTML, simulating clicks, or reverse-engineering the UI.

Think of it as:
- `robots.txt` → what crawlers *can't* do
- `sitemap.xml` → where pages *are*
- `agent.md` → what agents *can do*, and *how*

---

## Motivation

Today's AI agents interacting with web apps must:
- Take screenshots and parse visual layout
- Simulate mouse clicks and keyboard input
- Wait for DOM mutations and guess at state
- Reverse-engineer UI flows with no guaranteed stability

This is expensive, fragile, and wasteful. A web app that explicitly exposes agent-callable actions can be driven with near-zero overhead, full reliability, and explicit authorization.

`agent.md` fills the gap between:
- **MCP** (Model Context Protocol) — great for agent↔tool communication, but requires server-side infrastructure
- **llms.txt** — great for content/documentation discovery, but read-only
- **Raw browser automation** — works anywhere, but blind and brittle

`agent.md` + a browser extension MCP bridge gives agents a direct, low-cost interface to *any* web app that opts in — with no backend changes required beyond serving a single file and registering window functions.

---

## The Contract File: `/agent.md`

Every participating web app serves a Markdown file at `https://<domain>/agent.md`.

### Format

```markdown
# <App Name>

> <One-paragraph description of the app's purpose and domain>

## Auth
- type: <none | session | token>
- note: <optional human-readable note about authentication requirements>

## Actions

### <action_name>
- description: <What this action does>
- params:
  - <param_name> (<type>, required|optional): <description>
  - <param_name> (<type>, required|optional): <description>
- returns: <description of return value>
- example: `window.__agent.<action_name>({ <param>: <value> })`

### <action_name>
...
```

### Rules

1. The file MUST be served at exactly `/agent.md` from the root of the domain.
2. The file MUST be valid Markdown and human-readable.
3. All declared actions MUST be available on `window.__agent` when the page is loaded.
4. Each action MUST return a Promise resolving to a plain JSON-serializable object.
5. Each action MUST include an `ok: boolean` field in its return value.
6. On error, actions MUST return `{ ok: false, error: "<message>" }`.
7. Actions MUST NOT require the agent to interact with the DOM directly.
8. The `window.__agent` object MUST include a `__version` string matching the spec version in `agent.md`.

---

## The Window Interface: `window.__agent`

When a page loads, the web app registers its actions on `window.__agent`. A browser extension (or in-page script) can then call these functions directly.

### Reserved Properties

| Property | Type | Description |
|---|---|---|
| `__version` | string | Spec version, e.g. `"0.1.0"` |
| `__appName` | string | App name matching the H1 in agent.md |
| `__origin` | string | The origin this agent interface belongs to |

### Action Signature

```typescript
window.__agent.<action_name>(params: object): Promise<AgentResult>

interface AgentResult {
  ok: boolean;
  error?: string;   // present when ok === false
  [key: string]: unknown; // action-specific result fields
}
```

---

## The Browser Extension Bridge

A browser extension reads `/agent.md` from the active tab's origin, then exposes the declared actions as MCP tools over stdio. This allows any local MCP-capable agent (Claude Code, Cursor, custom scripts) to drive web apps through a clean tool interface — no DOM scraping required.

### Architecture

```
Local Agent (MCP Client)
        ↕ stdio / MCP protocol
Browser Extension (MCP Server + Bridge)
        ↕ chrome.scripting / window.__agent
Active Browser Tab (Web App)
        ↕ /agent.md discovery
agent.md contract
```

### Extension Behavior

1. On connection, the extension fetches `/agent.md` from the active tab's origin.
2. It parses the declared actions from the Markdown.
3. It registers one MCP tool per declared action.
4. When a tool is called, it injects a script into the active tab that calls `window.__agent.<action>()`.
5. The result is returned to the MCP client.

---

## Security Model

### What this is NOT

- This is NOT a way for remote agents to drive browsers without user consent.
- This is NOT an unauthenticated API — the browser session's existing auth applies.
- This is NOT a replacement for backend APIs for server-to-server use.

### What protects users

1. **Extension mediation**: The browser extension is a user-installed, user-controlled bridge. The user decides which agents can connect.
2. **Origin scoping**: `window.__agent` actions only apply to the current page's origin. The extension never calls actions cross-origin.
3. **Session auth passthrough**: Actions run in the context of the user's existing browser session — no separate credentials are shared with the agent.
4. **No DOM elevation**: Actions are explicitly declared JS functions, not arbitrary JS execution. Extensions should call only named `window.__agent.*` methods.
5. **Explicit opt-in**: A web app must deliberately serve `/agent.md` and register `window.__agent`. There is no passive exposure.

---

## Example: Todo App

### `/agent.md`

```markdown
# SimpleTodo

> A minimal todo list app. Supports creating, listing, completing, and deleting tasks.
> All data is stored per-user session.

## Auth
- type: session
- note: User must be logged in. Actions use the active browser session automatically.

## Actions

### list_todos
- description: Returns all todos for the current user
- params: none
- returns: Array of todo objects with id, title, completed, createdAt
- example: `window.__agent.list_todos({})`

### add_todo
- description: Creates a new todo item
- params:
  - title (string, required): The text of the todo item
- returns: The created todo object
- example: `window.__agent.add_todo({ title: "Buy milk" })`

### complete_todo
- description: Marks a todo item as completed
- params:
  - id (string, required): The ID of the todo to complete
- returns: The updated todo object
- example: `window.__agent.complete_todo({ id: "abc123" })`

### delete_todo
- description: Permanently deletes a todo item
- params:
  - id (string, required): The ID of the todo to delete
- returns: Confirmation with deleted id
- example: `window.__agent.delete_todo({ id: "abc123" })`
```

---

## Adoption Path

This spec is intentionally zero-infrastructure. To adopt it, a web app needs only:

1. Create and serve a static `/agent.md` file.
2. Add ~30 lines of JavaScript to register `window.__agent` actions.

No new backend routes, no API keys to manage, no SDK to install.

The browser extension MCP bridge is a separate, user-side component that any agent developer can build — web apps don't need to know it exists.

---

## Relationship to Existing Standards

| Standard | Role | Relationship |
|---|---|---|
| `robots.txt` | Crawler access control | Complementary — agent.md is opt-in action exposure |
| `llms.txt` | LLM content guidance | Complementary — llms.txt for content, agent.md for actions |
| MCP | Agent↔tool protocol | agent.md actions are surfaced *as* MCP tools by the bridge extension |
| OpenAPI | REST API description | Analogous in spirit, but client-side and session-scoped |

---

## Open Questions

- Should `/agent.md` support versioning with `?v=` params or ETags?
- Should there be a standard `__agent.describe()` method returning the parsed contract as JSON?
- Should the spec define a standard set of "universal" actions (e.g. `navigate`, `get_page_context`) all apps should implement?
- Should the extension maintain a local cache/registry of known agent.md contracts?
- How should multi-page apps handle action availability (SPA routing vs. page loads)?

---

## Contributing

This is an open draft. Discuss, fork, propose changes. The goal is a simple, adoptable standard — not a committee process.
