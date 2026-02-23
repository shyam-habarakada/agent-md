# agent.md

> A proposal and working prototype for a web standard that lets AI agents
> directly invoke web app actions — without scraping HTML, simulating
> clicks, or reverse-engineering UIs.

Network Working Group                                     Open Proposal
Request for Comments: draft-agent-md-00                  February 2026
Category: Standards Track

**Version:** 0.1.0
**Status:** Draft Proposal
**Authors:** Open proposal — contributions welcome

## Abstract

This document defines `agent.md`, a convention for web applications to
expose a structured, human- and machine-readable action contract at a
well-known URL (`/agent.md`). The contract describes what actions an
authorized agent may invoke on the application — without scraping HTML,
simulating clicks, or reverse-engineering the UI. It also defines the
`window.__agent` JavaScript interface that applications register to make
those actions callable, and describes a browser extension bridge that
surfaces declared actions as Model Context Protocol (MCP) tools.

## Status of This Memo

This document is a draft proposal open for community discussion and
contribution. It does not represent a finalized standard. Distribution
of this memo is unlimited.

## Table of Contents

    1.  Introduction
    2.  Conventions and Definitions
    3.  Motivation
    4.  The Contract File: /agent.md
        4.1.  Format
        4.2.  Requirements
    5.  The Window Interface: window.__agent
        5.1.  Reserved Properties
        5.2.  Action Signature
    6.  The Browser Extension Bridge
        6.1.  Architecture
        6.2.  Extension Behavior
    7.  Security Considerations
    8.  Adoption Path
    9.  Relationship to Existing Standards
    10. Running the Prototype
    11. What's in this Repo
    12. Open Questions
    13. Contributing

## 1. Introduction

`agent.md` is a convention for web applications to expose a structured,
human- and machine-readable contract at a well-known URL (`/agent.md`).
It describes what the app does and declares a set of JavaScript
functions that any authorized agent can discover and invoke.

The role of `agent.md` can be understood by analogy to existing
well-known files:

- `robots.txt` declares what crawlers MUST NOT do.
- `sitemap.xml` declares where pages are.
- `agent.md` declares what agents MAY do, and how.

Today, AI agents that interact with web apps must take screenshots and
parse visual layout, simulate mouse clicks and keyboard input, wait for
DOM mutations and guess at state, and reverse-engineer UI flows with no
stability guarantees. This is expensive, fragile, and absurd given that
the app *already knows* what it can do. There is simply no standard way
for a web app to say "here are my actions, here's how to call them."

`agent.md` fills that gap.

## 2. Conventions and Definitions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT",
"SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and
"OPTIONAL" in this document are to be interpreted as described in
BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all
capitals, as shown here.

**action**: A named JavaScript function declared in `/agent.md` and
registered on `window.__agent` that an agent may invoke.

**bridge extension**: A user-installed browser extension that reads
`/agent.md`, parses declared actions, and exposes them as MCP tools
over stdio.

**contract file**: The Markdown document served at `/agent.md`.

## 3. Motivation

AI agents interacting with web applications currently must take
screenshots and parse visual layout, simulate mouse clicks and keyboard
input, wait for DOM mutations and infer state, and reverse-engineer UI
flows with no guaranteed stability.

This approach is expensive, fragile, and wasteful. A web application
that explicitly exposes agent-callable actions can be driven with
near-zero overhead, full reliability, and explicit authorization.

`agent.md` fills the gap between several existing approaches:

- **MCP** (Model Context Protocol) is well-suited for agent-to-tool
  communication but requires server-side infrastructure the web
  application must build and operate.
- **llms.txt** supports content and documentation discovery but is
  read-only and does not declare callable actions.
- **Browser automation** works against any web application but is
  unaware of application structure and brittle against UI changes.

`agent.md` combined with a browser extension MCP bridge gives agents a
direct, low-overhead interface to any participating web application,
with no backend changes required beyond serving a single file and
registering window functions.

## 4. The Contract File: /agent.md

Every participating web application MUST serve a Markdown file at
`https://<domain>/agent.md`.

### 4.1. Format

The contract file follows the schema below:

```markdown
# <App Name>

> <Description of the app's purpose and domain>

## Auth

In this initial version, we assume that the agent is operating on
behalf of the user in their existing browser session. In this case,
the agent (e.g. Claude co-work) will effectively "inherit" the user's
authentication and permissions.

Future versions of the spec may support additional authentication modes.

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

### 4.2. Requirements

1. The file MUST be served at exactly `/agent.md` from the root of the
   domain.
2. The file MUST be valid Markdown and human-readable without tooling.
3. All declared actions MUST be available on `window.__agent` when the
   page is loaded.
4. Each action MUST return a Promise resolving to a plain
   JSON-serializable object.
5. Each action MUST include an `ok: boolean` field in its return value.
6. On error, actions MUST return `{ ok: false, error: "<message>" }`.
7. Actions MUST NOT require the agent to interact with the DOM directly.
8. The `window.__agent` object MUST include a `__version` string
   matching the spec version declared in `agent.md`.

## 5. The Window Interface: window.__agent

When a page loads, the web application registers its actions on
`window.__agent`. A browser extension or in-page script may then call
these functions directly.

### 5.1. Reserved Properties

| Property     | Type   | Description                                      |
|--------------|--------|--------------------------------------------------|
| `__version`  | string | Spec version, e.g. `"0.1.0"`                    |
| `__appName`  | string | App name matching the H1 in agent.md             |
| `__origin`   | string | The origin this agent interface belongs to       |

### 5.2. Action Signature

```typescript
window.__agent.<action_name>(params: object): Promise<AgentResult>

interface AgentResult {
  ok: boolean;
  error?: string;   // present when ok === false
  [key: string]: unknown; // action-specific result fields
}
```

## 6. The Browser Extension Bridge

A browser extension reads `/agent.md` from the active tab's origin and
exposes the declared actions as MCP tools over stdio. This allows any
local MCP-capable agent (Claude Code, Cursor, custom scripts) to drive
web applications through a clean tool interface without DOM interaction.

### 6.1. Architecture

```
Local Agent (MCP Client)
        ↕ stdio / MCP protocol
Browser Extension (MCP Server + Bridge)
        ↕ chrome.scripting / window.__agent
Active Browser Tab (Web Application)
        ↕ /agent.md discovery
agent.md contract
```

### 6.2. Extension Behavior

1. On connection, the extension fetches `/agent.md` from the active
   tab's origin.
2. It parses the declared actions from the Markdown contract.
3. It registers one MCP tool per declared action.
4. When a tool is called, it injects a script into the active tab that
   invokes `window.__agent.<action>()`.
5. The result is returned to the MCP client.

## 7. Security Considerations

### 7.1. Scope of This Protocol

This protocol is NOT a mechanism for remote agents to drive browsers
without user consent. It is NOT an unauthenticated API — the browser
session's existing authentication applies. It is NOT intended as a
replacement for backend APIs in server-to-server communication.

### 7.2. Protections

**Extension mediation.** The browser extension is a user-installed,
user-controlled bridge. The user decides which agents may connect.

**Origin scoping.** `window.__agent` actions apply only to the current
page's origin. The extension MUST NOT call actions cross-origin.

**Session authentication passthrough.** Actions run in the context of
the user's existing browser session. No credentials are shared with the
agent.

**No DOM elevation.** Actions are explicitly declared JavaScript
functions, not arbitrary code execution. Extensions SHOULD invoke only
named `window.__agent.*` methods.

**Explicit opt-in.** A web application must deliberately serve
`/agent.md` and register `window.__agent`. There is no passive
exposure.

## 8. Adoption Path

This specification is intentionally zero-infrastructure. To adopt it, a
web application requires only:

1. A static `/agent.md` file served from the domain root.
2. Approximately 30 lines of JavaScript to register `window.__agent`
   actions on page load.

No new backend routes, no API keys, and no SDK installation are
required. The browser extension MCP bridge is a user-side component
that agent developers may build independently; web applications need not
be aware of its existence.

### 8.1. Create /agent.md

```markdown
# MyApp

> Brief description of what your app does.

## Auth

The agent operates on behalf of the user using their existing browser
session. No additional credentials are required.

## Actions

### my_action
- description: What this does
- params:
  - param_name (string, required): What this param is
- returns: What gets returned
- example: `window.__agent.my_action({ param_name: "value" })`
```

### 8.2. Register window.__agent

```javascript
window.__agent = {
  __version: '0.1.0',
  __appName: 'MyApp',
  __origin: window.location.origin,

  my_action: async ({ param_name }) => {
    try {
      const result = await yourInternalFunction(param_name);
      return { ok: true, ...result };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }
};
```

That's it. Your app is now agent-accessible.

### 8.3. Example: Todo Application

The following is a complete example contract file for a minimal todo
application.

```markdown
# SimpleTodo

> A minimal todo list app. Supports creating, listing, completing, and
> deleting tasks. All data is stored per-user session.

## Auth

The agent operates on behalf of the logged-in user using their existing
browser session.

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

## 9. Relationship to Existing Standards

| Standard    | Role                       | Relationship to agent.md                               |
|-------------|----------------------------|--------------------------------------------------------|
| `robots.txt`| Crawler access control     | Complementary — agent.md is opt-in action exposure     |
| `llms.txt`  | LLM content guidance       | Complementary — llms.txt for content, agent.md for actions |
| MCP         | Agent-to-tool protocol     | agent.md actions are surfaced as MCP tools by the bridge |
| OpenAPI     | REST API description       | Analogous in spirit, but client-side and session-scoped |

MCP is excellent for agent-to-tool communication, but it assumes a
server you control. Most web apps don't want to build and operate an
MCP server just to be agent-accessible. `agent.md` combined with the
browser extension bridge gives you MCP compatibility without any backend
infrastructure — the bridge runs on the user's side, and the web app
needs only a static file and ~30 lines of JS.

| Approach                     | Requires backend changes | Works with session auth | Agent discovers actions |
|------------------------------|--------------------------|-------------------------|-------------------------|
| Browser automation           | No                       | Yes                     | No                      |
| MCP server                   | Yes                      | No (separate auth)      | Yes                     |
| **agent.md + bridge**        | **No**                   | **Yes**                 | **Yes**                 |

## 10. Running the Prototype

### Step 1: Serve the web app

```bash
python3 -m http.server 8080
# Open http://localhost:8080
```

### Step 2: Install the browser extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select this repo's root folder
4. Note your extension ID (e.g. `abcdefghijklmnopabcdefghijklmnop`)

### Step 3: Register the native messaging host

```bash
node install.js <your-extension-id>
# Restart Chrome
```

### Step 4: Run the sample agent

```bash
# Mock mode (no browser or API key needed):
node agent.js --mock "Add three todos and complete the first one"

# With live browser (extension must be running):
node agent.js "Add three todos and complete the first one"

# With Claude driving the agent loop:
ANTHROPIC_API_KEY=sk-... node agent.js "Add three todos and complete the first one"
```

### What you'll see

The agent:
1. Calls `tools/list` → extension fetches `/agent.md` → returns 6 MCP tools
2. Calls tools in sequence (no screenshots, no clicks, no DOM parsing)
3. Gets structured JSON responses back
4. The todo app UI updates in real time

## 11. What's in this Repo

```
agent-md/
├── README.md          # This document (spec + prototype guide)
├── agent.md           # Example contract file served at /agent.md
├── index.html         # SimpleTodo demo app with window.__agent registered
├── manifest.json      # Chrome extension manifest (MV3)
├── background.js      # Extension service worker: discovery, routing, MCP bridge
├── popup.html         # Extension popup showing active tab contract status
├── host.js            # Native messaging host (stdio ↔ Chrome extension)
├── install.js         # Registers the native host with Chrome
└── agent.js           # Sample Node.js agent with MCP client and agentic loop
```

## 12. Open Questions

The following questions are open for community discussion:

- Should `/agent.md` support versioning via `?v=` query parameters or
  ETags?
- Should there be a standard `__agent.describe()` method that returns
  the parsed contract as a JSON object?
- Should the spec define a set of universal actions (e.g. `navigate`,
  `get_page_context`) that all conforming applications SHOULD implement?
- Should the bridge extension maintain a local cache or registry of
  known `agent.md` contracts?
- How should multi-page applications handle action availability across
  SPA route changes versus full page loads?
- How should single-page applications (SPAs) handle dynamic registration
  of actions as the user navigates within the app?

## 13. Contributing

This is an open draft. Discussion, forks, and proposed changes are
welcome. The goal is a simple, adoptable standard arrived at through
rough consensus, not a committee process.

PRs and issues welcome at https://github.com/shyam-habarakada/agent-md.
