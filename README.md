# agent.md — Prototype

> A proposal and working prototype for a web standard that lets AI agents directly invoke web app actions — without scraping HTML, simulating clicks, or reverse-engineering UIs.

---

## The Problem

Today, AI agents that need to interact with web apps must:

- Take screenshots and parse visual layout
- Simulate mouse clicks and keyboard input  
- Wait for DOM mutations and guess at state
- Reverse-engineer UI flows with no stability guarantees

This is expensive, fragile, and absurd given that the app *already knows* what it can do. There's simply no standard way for a web app to say "here are my actions, here's how to call them."

`robots.txt` says what crawlers *can't* do. `sitemap.xml` says where pages *are*. **`agent.md` says what agents *can do* and *how*.**

---

## The Solution

Three simple pieces:

### 1. `/agent.md` — The Contract File

A web app serves a human+machine-readable Markdown file at `/agent.md` declaring:
- What the app does (plain English)
- What actions agents can call
- What parameters each action takes

```markdown
# SimpleTodo

> A minimal todo list app. Supports creating, listing, completing, and deleting tasks.

## Actions

### add_todo
- description: Creates a new todo item
- params:
  - title (string, required): The text of the todo item
- returns: The created todo object
- example: `window.__agent.add_todo({ title: "Buy milk" })`
```

### 2. `window.__agent` — The JS Interface

The web app registers callable functions on `window.__agent`. Each function:
- Accepts a plain params object (matching `agent.md`)
- Returns a Promise resolving to `{ ok: boolean, ...result }`
- Never requires the agent to touch the DOM

```javascript
// Agent calls this directly — no click simulation needed
const result = await window.__agent.add_todo({ title: "Buy milk" });
// → { ok: true, id: "abc123", title: "Buy milk", completed: false }
```

### 3. Browser Extension MCP Bridge

A user-installed browser extension:
1. Fetches `/agent.md` from the active tab's origin
2. Parses the declared actions
3. Exposes them as **MCP tools** to any local agent
4. Routes tool calls → `window.__agent` calls on the live page

```
Local Agent (MCP Client)
        ↕ stdio / MCP
Browser Extension (MCP Server + Bridge)
        ↕ chrome.scripting
Active Tab (Web App with window.__agent)
        ↕ /agent.md discovery
The Contract
```

---

## What's in this Repo

```
agentmd/
├── spec/
│   └── AGENT-MD-SPEC.md          # Full specification (v0.1.0)
│
├── webapp/
│   ├── agent.md                  # Contract file served at /agent.md
│   └── index.html                # Todo app with window.__agent registered
│
├── extension/
│   ├── manifest.json             # Chrome extension manifest (MV3)
│   ├── background.js             # MCP bridge service worker
│   ├── popup.html                # Shows active tab contract status
│   └── native-host/
│       ├── host.js               # Native messaging host (stdio↔extension)
│       ├── install.js            # Registers host with Chrome
│       └── com.agentmd.bridge.json
│
└── agent-client/
    └── agent.js                  # Sample agent that drives the todo app
```

---

## Running the Prototype

### Step 1: Serve the web app

```bash
cd webapp
npx serve .   # or: python3 -m http.server 8080
# Open http://localhost:8080
```

### Step 2: Install the browser extension

1. Open Chrome → `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked" → select the `extension/` folder
4. Note your extension ID (e.g. `abcdefghijklmnopabcdefghijklmnop`)

### Step 3: Register the native messaging host

```bash
cd extension/native-host
node install.js <your-extension-id>
# Restart Chrome
```

### Step 4: Run the sample agent

```bash
cd agent-client

# Mock mode (no browser needed, no API key needed):
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
4. The todo app UI updates in real time (because `window.__agent` calls the same code as UI buttons)

---

## Implementing agent.md in Your App

It's ~30 lines of JS and one Markdown file. No backend changes needed.

### 1. Create `/agent.md`

```markdown
# MyApp

> Brief description of what your app does.

## Auth
- type: session

## Actions

### my_action
- description: What this does
- params:
  - param_name (string, required): What this param is
- returns: What gets returned
- example: `window.__agent.my_action({ param_name: "value" })`
```

### 2. Register `window.__agent`

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

---

## Why Not Just MCP?

MCP is excellent for agent↔tool communication, but it assumes a server you control. Most web apps don't want to build and operate an MCP server just to be agent-accessible. `agent.md` + the browser extension bridge gives you MCP compatibility *without* any backend infrastructure — the bridge is on the user's side, and the web app only needs a static file and some JS.

| Approach | Requires backend changes | Works with existing session auth | Agent discovers actions automatically |
|---|---|---|---|
| Browser automation (screenshots) | No | Yes | No |
| MCP server | Yes (new server) | No (separate auth) | Yes |
| **agent.md + bridge** | **No** | **Yes** | **Yes** |

---

## Security

- The web app **opts in explicitly** by serving `/agent.md` and registering `window.__agent`
- The bridge extension is **user-installed** and **user-controlled**
- Actions run in the **user's browser session** — existing app auth applies
- The bridge calls **only named `window.__agent.*` methods**, not arbitrary JS
- **No credentials are shared** with the agent — it just invokes declared functions

---

## Status & Contributing

This is a `v0.1.0` draft prototype. The spec is in `spec/AGENT-MD-SPEC.md`.

Open questions worth discussing:
- Should `agent.md` support a machine-readable JSON variant at `/agent.json`?
- Should there be a universal `__agent.describe()` returning parsed contract as JSON?
- How should SPAs handle action availability across route changes?
- Should the spec define a standard set of "platform-level" actions all apps should support?

PRs, issues, and forks welcome. The goal is the simplest thing that works.
