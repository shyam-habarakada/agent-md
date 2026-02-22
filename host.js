#!/usr/bin/env node
/**
 * agent.md Native Messaging Host
 *
 * This process runs locally and acts as the bridge between:
 *   - The MCP client (local agent speaking JSON-RPC over stdio)
 *   - The Chrome extension (speaking Chrome native messaging protocol)
 *
 * Chrome native messaging uses a simple length-prefixed JSON protocol:
 *   [4 bytes little-endian length][JSON message bytes]
 *
 * This host forwards MCP JSON-RPC messages from stdin → extension,
 * and routes responses from extension → stdout.
 *
 * Install:
 *   1. Run: node install.js   (registers this host with Chrome)
 *   2. The extension connects automatically on startup
 *
 * The MCP client connects via stdio as usual.
 */

'use strict';

const { stdin, stdout, stderr } = process;

// ─── Chrome native messaging framing ──────────────────────────────────────────

function readMessage(callback) {
  let headerBuf = Buffer.alloc(0);

  stdin.on('readable', () => {
    let chunk;
    while ((chunk = stdin.read()) !== null) {
      headerBuf = Buffer.concat([headerBuf, chunk]);

      while (headerBuf.length >= 4) {
        const msgLen = headerBuf.readUInt32LE(0);
        if (headerBuf.length < 4 + msgLen) break;

        const msgJson = headerBuf.slice(4, 4 + msgLen).toString('utf8');
        headerBuf = headerBuf.slice(4 + msgLen);

        try {
          callback(JSON.parse(msgJson));
        } catch (e) {
          stderr.write(`[agentmd-host] Parse error: ${e.message}\n`);
        }
      }
    }
  });
}

function sendMessage(msg) {
  const json = JSON.stringify(msg);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  stdout.write(Buffer.concat([header, buf]));
}

// ─── MCP stdio framing ────────────────────────────────────────────────────────
// When used as an MCP server (not native host mode), we speak JSON-RPC
// over newline-delimited stdin/stdout.

// Detect mode: if launched by Chrome, stdin will deliver framed messages.
// If launched by an MCP client directly, we speak line-delimited JSON-RPC.
// For simplicity in this prototype, we handle both by trying the framed
// protocol first and falling back.

// ─── Message routing ──────────────────────────────────────────────────────────
// In production this process stays alive, holds the extension port, and
// routes messages. Here we show the protocol clearly.

const pendingRequests = new Map(); // id → { resolve, reject }

// Messages from extension → forward to MCP client
function onExtensionMessage(msg) {
  stderr.write(`[agentmd-host] ← extension: ${JSON.stringify(msg)}\n`);

  if (msg.id !== undefined && pendingRequests.has(msg.id)) {
    const { resolve } = pendingRequests.get(msg.id);
    pendingRequests.delete(msg.id);
    resolve(msg);
  }

  // Also forward raw to stdout for MCP client
  const line = JSON.stringify(msg) + '\n';
  process.stdout.write(line);
}

// Messages from MCP client → forward to extension
process.stdin.setEncoding('utf8');
let inputBuffer = '';

process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;
  const lines = inputBuffer.split('\n');
  inputBuffer = lines.pop(); // keep incomplete line

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      stderr.write(`[agentmd-host] → extension: ${JSON.stringify(msg)}\n`);
      sendMessage(msg); // forward to extension via native messaging
    } catch (e) {
      stderr.write(`[agentmd-host] Invalid JSON from MCP client: ${e.message}\n`);
    }
  }
});

// Receive from extension
readMessage(onExtensionMessage);

stderr.write('[agentmd-host] Native messaging host started\n');

process.on('disconnect', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
