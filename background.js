/**
 * agent.md Bridge — Background Service Worker
 *
 * This is the core of the bridge. It:
 * 1. Connects to a native messaging host (the local MCP server process)
 * 2. Fetches /agent.md from the active tab's origin
 * 3. Parses declared actions from the Markdown
 * 4. Routes MCP tool calls → window.__agent calls on the active tab
 * 5. Returns results back to the MCP client via the native host
 */

// ─── Native messaging connection ──────────────────────────────────────────────
// The native host is a small local process (see native-host/) that speaks
// MCP over stdio on one side and Chrome native messaging on the other.

let nativePort = null;

function connectNativeHost() {
  try {
    nativePort = chrome.runtime.connectNative('com.agentmd.bridge');
    nativePort.onMessage.addListener(handleMCPMessage);
    nativePort.onDisconnect.addListener(() => {
      console.log('[agentmd] Native host disconnected:', chrome.runtime.lastError?.message);
      nativePort = null;
      // Reconnect after 2s
      setTimeout(connectNativeHost, 2000);
    });
    console.log('[agentmd] Connected to native host');
  } catch (err) {
    console.log('[agentmd] Native host not available (run without it for testing):', err.message);
  }
}

// ─── agent.md discovery & parsing ────────────────────────────────────────────

const contractCache = new Map(); // origin → parsed contract

async function fetchAndParseContract(origin) {
  if (contractCache.has(origin)) return contractCache.get(origin);

  const url = `${origin}/agent.md`;
  let text;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    text = await res.text();
  } catch {
    return null;
  }

  const contract = parseAgentMd(text);
  contractCache.set(origin, contract);
  return contract;
}

/**
 * Parse agent.md Markdown into a structured contract.
 * 
 * Extracts:
 *   - appName (H1)
 *   - description (blockquote after H1)
 *   - auth (from ## Auth section)
 *   - actions[] (from ## Actions, each ### heading is one action)
 */
function parseAgentMd(markdown) {
  const lines = markdown.split('\n');
  const contract = { appName: '', description: '', auth: {}, actions: [] };

  let section = null;
  let currentAction = null;
  let inActionsSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // H1 → app name
    if (line.startsWith('# ') && !contract.appName) {
      contract.appName = line.slice(2).trim();
      continue;
    }

    // Blockquote immediately after H1 → description
    if (line.startsWith('> ') && !contract.description) {
      contract.description = line.slice(2).trim();
      continue;
    }

    // ## section headers
    if (line.startsWith('## ')) {
      section = line.slice(3).trim().toLowerCase();
      inActionsSection = section === 'actions';
      currentAction = null;
      continue;
    }

    // ### action headers (inside ## Actions)
    if (line.startsWith('### ') && inActionsSection) {
      if (currentAction) contract.actions.push(currentAction);
      currentAction = {
        name: line.slice(4).trim(),
        description: '',
        params: [],
        returns: '',
        example: ''
      };
      continue;
    }

    // Parse action properties
    if (currentAction) {
      const stripped = line.trim();
      if (stripped.startsWith('- description:')) {
        currentAction.description = stripped.slice('- description:'.length).trim();
      } else if (stripped.startsWith('- returns:')) {
        currentAction.returns = stripped.slice('- returns:'.length).trim();
      } else if (stripped.startsWith('- example:')) {
        currentAction.example = stripped.slice('- example:'.length).trim();
      } else if (stripped.startsWith('- params:') && stripped === '- params: none') {
        currentAction.params = [];
      } else if (stripped.match(/^- (\w+) \((.+?),\s*(required|optional)\):/)) {
        // param line: `  - paramName (type, required): description`
        const m = stripped.match(/^- (\w+) \((.+?),\s*(required|optional)\):\s*(.*)/);
        if (m) {
          currentAction.params.push({
            name: m[1],
            type: m[2].trim(),
            required: m[3] === 'required',
            description: m[4].trim()
          });
        }
      }

      // Auth section
    } else if (section === 'auth') {
      const stripped = line.trim();
      if (stripped.startsWith('- type:')) {
        contract.auth.type = stripped.slice('- type:'.length).trim();
      } else if (stripped.startsWith('- note:')) {
        contract.auth.note = stripped.slice('- note:'.length).trim();
      }
    }
  }

  if (currentAction) contract.actions.push(currentAction);
  return contract;
}

// ─── Execute window.__agent call in the active tab ────────────────────────────

async function callAgentAction(tabId, actionName, params) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: async (actionName, params) => {
      if (!window.__agent) {
        return { ok: false, error: 'window.__agent is not available on this page' };
      }
      if (typeof window.__agent[actionName] !== 'function') {
        return { ok: false, error: `Action "${actionName}" not found on window.__agent` };
      }
      try {
        return await window.__agent[actionName](params);
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },
    args: [actionName, params]
  });

  return results[0]?.result ?? { ok: false, error: 'Script execution failed' };
}

// ─── MCP message handling ─────────────────────────────────────────────────────
// The native host forwards MCP JSON-RPC messages here.
// We handle: initialize, tools/list, tools/call

async function handleMCPMessage(message) {
  const { id, method, params } = message;

  try {
    let result;

    if (method === 'initialize') {
      result = {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'agentmd-bridge', version: '0.1.0' }
      };

    } else if (method === 'tools/list') {
      result = await handleToolsList();

    } else if (method === 'tools/call') {
      result = await handleToolCall(params);

    } else {
      sendMCPError(id, -32601, `Method not found: ${method}`);
      return;
    }

    sendMCPResponse(id, result);

  } catch (err) {
    sendMCPError(id, -32603, err.message);
  }
}

async function handleToolsList() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return { tools: [] };

  const origin = new URL(tab.url).origin;
  const contract = await fetchAndParseContract(origin);
  if (!contract) return { tools: [] };

  const tools = contract.actions.map(action => ({
    name: `agentmd_${action.name}`,
    description: `[${contract.appName}] ${action.description}`,
    inputSchema: buildInputSchema(action)
  }));

  return { tools };
}

async function handleToolCall({ name, arguments: args }) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { content: [{ type: 'text', text: JSON.stringify({ ok: false, error: 'No active tab' }) }] };
  }

  // Strip the "agentmd_" prefix to get the real action name
  const actionName = name.replace(/^agentmd_/, '');
  const result = await callAgentAction(tab.id, actionName, args || {});

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    isError: result.ok === false
  };
}

function buildInputSchema(action) {
  if (!action.params || action.params.length === 0) {
    return { type: 'object', properties: {}, required: [] };
  }

  const properties = {};
  const required = [];

  for (const param of action.params) {
    properties[param.name] = {
      type: mapType(param.type),
      description: param.description
    };
    if (param.required) required.push(param.name);
  }

  return { type: 'object', properties, required };
}

function mapType(type) {
  if (type === 'string') return 'string';
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  return 'string'; // fallback
}

function sendMCPResponse(id, result) {
  if (nativePort) {
    nativePort.postMessage({ jsonrpc: '2.0', id, result });
  }
}

function sendMCPError(id, code, message) {
  if (nativePort) {
    nativePort.postMessage({ jsonrpc: '2.0', id, error: { code, message } });
  }
}

// ─── Message handler for popup / devtools ────────────────────────────────────
// Allows the extension popup to query contract info without going through MCP

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_CONTRACT') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.url) return sendResponse({ contract: null });
      const origin = new URL(tab.url).origin;
      const contract = await fetchAndParseContract(origin);
      sendResponse({ contract, origin });
    });
    return true; // async response
  }

  if (message.type === 'CALL_ACTION') {
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab) return sendResponse({ ok: false, error: 'No active tab' });
      const result = await callAgentAction(tab.id, message.action, message.params || {});
      sendResponse(result);
    });
    return true;
  }

  if (message.type === 'INVALIDATE_CACHE') {
    contractCache.clear();
    sendResponse({ ok: true });
    return true;
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
connectNativeHost();
