#!/usr/bin/env node
/**
 * Registers the agent.md native messaging host with Chrome/Chromium.
 * Run once after installing the extension.
 *
 * Usage:
 *   node install.js <extension-id>
 *
 * Example:
 *   node install.js abcdefghijklmnopabcdefghijklmnop
 */

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const extensionId = process.argv[2];
if (!extensionId) {
  console.error('Usage: node install.js <chrome-extension-id>');
  console.error('Find your extension ID at chrome://extensions');
  process.exit(1);
}

const hostPath = path.resolve(__dirname, 'host.js');
const manifest = {
  name: 'com.agentmd.bridge',
  description: 'agent.md MCP bridge native host',
  path: `node ${hostPath}`,
  type: 'stdio',
  allowed_origins: [`chrome-extension://${extensionId}/`]
};

const manifestJson = JSON.stringify(manifest, null, 2);

let targetDir;
const platform = os.platform();

if (platform === 'darwin') {
  targetDir = path.join(os.homedir(), 'Library/Application Support/Google/Chrome/NativeMessagingHosts');
} else if (platform === 'linux') {
  targetDir = path.join(os.homedir(), '.config/google-chrome/NativeMessagingHosts');
} else if (platform === 'win32') {
  // On Windows, path goes in registry — print instructions
  console.log('Windows: Add the following registry key:');
  console.log('HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.agentmd.bridge');
  console.log('Value: path to com.agentmd.bridge.json');
  const manifestPath = path.join(__dirname, 'com.agentmd.bridge.json');
  fs.writeFileSync(manifestPath, manifestJson);
  console.log(`\nManifest written to: ${manifestPath}`);
  process.exit(0);
} else {
  console.error(`Unsupported platform: ${platform}`);
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
const manifestPath = path.join(targetDir, 'com.agentmd.bridge.json');
fs.writeFileSync(manifestPath, manifestJson);

console.log(`✓ Native host registered at: ${manifestPath}`);
console.log(`✓ Extension ID: ${extensionId}`);
console.log('\nRestart Chrome, then the bridge will connect automatically.');
