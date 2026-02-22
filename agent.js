#!/usr/bin/env node
/**
 * agent.md Sample Agent Client
 *
 * Demonstrates how a local agent can:
 *   1. Discover what actions a web app supports (via MCP tools/list)
 *   2. Drive the app through clean function calls (no DOM scraping)
 *   3. Compose multiple actions to accomplish a user goal
 *
 * This script connects to the agent.md bridge MCP server (the browser
 * extension's native host) via stdio, then uses Claude to plan and
 * execute a sequence of todo app actions based on a natural language goal.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-... node agent.js "Add three todos about groceries, complete the first one, then list all todos"
 *
 * Without a live bridge (for testing), use --mock to simulate responses.
 */

'use strict';

const { spawn } = require('child_process');
const readline = require('readline');

// ─── MCP Client ───────────────────────────────────────────────────────────────
// Minimal MCP client that speaks JSON-RPC over stdio to the bridge process.

class MCPClient {
  constructor(serverCommand, serverArgs = []) {
    this.serverCommand = serverCommand;
    this.serverArgs = serverArgs;
    this.process = null;
    this.pendingRequests = new Map();
    this.nextId = 1;
    this.rl = null;
  }

  async connect() {
    this.process = spawn(this.serverCommand, this.serverArgs, {
      stdio: ['pipe', 'pipe', 'inherit']
    });

    this.rl = readline.createInterface({ input: this.process.stdout });
    this.rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const { resolve, reject } = this.pendingRequests.get(msg.id);
          this.pendingRequests.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result);
        }
      } catch (e) {
        console.error('[client] Parse error:', e.message, 'from line:', line.slice(0, 100));
      }
    });

    this.process.on('exit', (code) => {
      console.log(`[client] MCP server exited with code ${code}`);
    });

    await this.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'agentmd-sample-client', version: '0.1.0' }
    });

    console.log('[client] Connected to MCP server\n');
  }

  request(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pendingRequests.set(id, { resolve, reject });
      const msg = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      this.process.stdin.write(msg);

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 10000);
    });
  }

  async listTools() {
    const result = await this.request('tools/list');
    return result.tools || [];
  }

  async callTool(name, args = {}) {
    const result = await this.request('tools/call', { name, arguments: args });
    if (result.content?.[0]?.text) {
      try { return JSON.parse(result.content[0].text); }
      catch { return result.content[0].text; }
    }
    return result;
  }

  disconnect() {
    if (this.rl) this.rl.close();
    if (this.process) this.process.kill();
  }
}

// ─── Mock MCP Client (for testing without a live browser) ────────────────────

class MockMCPClient {
  constructor() {
    this.todos = [];
    this.nextTodoId = 1;
  }

  async connect() {
    console.log('[mock] Using mock MCP client (no live browser needed)\n');
  }

  async listTools() {
    return [
      { name: 'agentmd_list_todos', description: '[SimpleTodo] Returns all todo items for the current session' },
      { name: 'agentmd_add_todo', description: '[SimpleTodo] Creates a new todo item' },
      { name: 'agentmd_complete_todo', description: '[SimpleTodo] Marks an existing todo item as completed' },
      { name: 'agentmd_uncomplete_todo', description: '[SimpleTodo] Marks a completed todo item as not completed' },
      { name: 'agentmd_delete_todo', description: '[SimpleTodo] Permanently deletes a todo item' },
      { name: 'agentmd_clear_completed', description: '[SimpleTodo] Deletes all todo items that are marked as completed' },
    ];
  }

  async callTool(name, args = {}) {
    const action = name.replace('agentmd_', '');
    console.log(`  [mock] Executing: ${name}(${JSON.stringify(args)})`);

    switch (action) {
      case 'list_todos':
        return { ok: true, todos: this.todos };

      case 'add_todo': {
        if (!args.title?.trim()) return { ok: false, error: 'title is required' };
        const todo = {
          id: `todo_${this.nextTodoId++}`,
          title: args.title.trim(),
          completed: false,
          createdAt: new Date().toISOString()
        };
        this.todos.push(todo);
        return { ok: true, ...todo };
      }

      case 'complete_todo': {
        const t = this.todos.find(t => t.id === args.id);
        if (!t) return { ok: false, error: `Todo "${args.id}" not found` };
        t.completed = true;
        return { ok: true, ...t };
      }

      case 'uncomplete_todo': {
        const t = this.todos.find(t => t.id === args.id);
        if (!t) return { ok: false, error: `Todo "${args.id}" not found` };
        t.completed = false;
        return { ok: true, ...t };
      }

      case 'delete_todo': {
        const idx = this.todos.findIndex(t => t.id === args.id);
        if (idx === -1) return { ok: false, error: `Todo "${args.id}" not found` };
        this.todos.splice(idx, 1);
        return { ok: true, id: args.id };
      }

      case 'clear_completed': {
        const before = this.todos.length;
        this.todos = this.todos.filter(t => !t.completed);
        return { ok: true, count: before - this.todos.length };
      }

      default:
        return { ok: false, error: `Unknown action: ${action}` };
    }
  }

  disconnect() {}
}

// ─── Agent loop ───────────────────────────────────────────────────────────────
// Uses Claude to plan and execute a sequence of tool calls based on the goal.
// This is a simple agentic loop — no framework needed.

async function runAgent(goal, client) {
  // Step 1: Discover available tools
  console.log('Discovering available tools from active tab...');
  const tools = await client.listTools();

  if (tools.length === 0) {
    console.log('No agent.md tools available. Is the browser extension running and a compatible site active?');
    return;
  }

  console.log(`Found ${tools.length} tools:\n`);
  tools.forEach(t => console.log(`  • ${t.name}: ${t.description}`));
  console.log();

  // Step 2: Use Claude to plan and execute
  // In production this would call the Anthropic API.
  // Here we show the agentic loop structure clearly.

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log('No ANTHROPIC_API_KEY set — running in demo mode with hardcoded plan.\n');
    await runDemoPlan(client, goal);
    return;
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey });

  const mcpTools = tools.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema || { type: 'object', properties: {} }
  }));

  const messages = [
    {
      role: 'user',
      content: `You are controlling a web app via its agent.md interface. 
      
The available tools are the web app's declared actions — call them to accomplish the user's goal.
Always call list_todos first to understand current state before making changes.
After completing all actions, summarize what you did.

User goal: ${goal}`
    }
  ];

  console.log(`Executing goal: "${goal}"\n`);
  console.log('─'.repeat(50));

  // Agentic loop
  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      tools: mcpTools,
      messages
    });

    // Collect text and tool use blocks
    let hasToolCalls = false;
    const toolResults = [];

    for (const block of response.content) {
      if (block.type === 'text' && block.text) {
        console.log('\n' + block.text);
      }

      if (block.type === 'tool_use') {
        hasToolCalls = true;
        console.log(`\n→ Calling: ${block.name}(${JSON.stringify(block.input)})`);

        const result = await client.callTool(block.name, block.input);
        console.log(`← Result: ${JSON.stringify(result)}`);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result)
        });
      }
    }

    // Add assistant turn to history
    messages.push({ role: 'assistant', content: response.content });

    if (!hasToolCalls || response.stop_reason === 'end_turn') break;

    // Add tool results and continue
    messages.push({ role: 'user', content: toolResults });
  }
}

// Hardcoded demo plan when no API key is set
async function runDemoPlan(client, goal) {
  console.log(`Demo mode — executing a hardcoded plan for: "${goal}"\n`);
  console.log('─'.repeat(50));

  // 1. List current todos
  console.log('\n[1/5] List current todos');
  const listResult = await client.callTool('agentmd_list_todos', {});
  console.log(`      → ${listResult.todos?.length ?? 0} existing todos`);

  // 2. Add three todos
  const items = ['Buy milk', 'Walk the dog', 'Read for 30 minutes'];
  const created = [];
  for (let i = 0; i < items.length; i++) {
    console.log(`\n[${i + 2}/5] Add todo: "${items[i]}"`);
    const r = await client.callTool('agentmd_add_todo', { title: items[i] });
    if (r.ok) {
      created.push(r);
      console.log(`      → Created with id: ${r.id}`);
    }
  }

  // 3. Complete the first one
  if (created[0]) {
    console.log(`\n[5/5] Complete: "${created[0].title}"`);
    const r = await client.callTool('agentmd_complete_todo', { id: created[0].id });
    console.log(`      → ok: ${r.ok}`);
  }

  // 4. Final list
  console.log('\n─'.repeat(50));
  console.log('Final state:');
  const final = await client.callTool('agentmd_list_todos', {});
  (final.todos || []).forEach(t => {
    console.log(`  [${t.completed ? '✓' : ' '}] ${t.title}  (id: ${t.id})`);
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const useMock = args.includes('--mock') || args[0] === '--mock';
  const goal = args.filter(a => !a.startsWith('--')).join(' ') ||
    'Add three todos about healthy habits, complete the first one, then show all todos';

  let client;

  if (useMock) {
    client = new MockMCPClient();
  } else {
    // Connect to the native host which bridges to the extension
    // The native host must be registered first via: node native-host/install.js <extension-id>
    client = new MCPClient('node', [
      `${__dirname}/../extension/native-host/host.js`
    ]);
  }

  await client.connect();

  try {
    await runAgent(goal, client);
  } finally {
    client.disconnect();
  }
}

main().catch(err => {
  console.error('[agent] Fatal error:', err);
  process.exit(1);
});
