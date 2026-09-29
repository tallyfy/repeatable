'use strict';

// Repeatable bundles no MCP server (#15).
//
// The Tallyfy plugin bundles the Tallyfy server, and a second copy here gave
// users who installed both plugins every Tallyfy tool twice. Repeatable uses
// whatever Tallyfy connection the user already has. This test fails if a
// server declaration comes back, either as .mcp.json or inside plugin.json.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function bundledServers(root) {
  const found = [];
  if (fs.existsSync(path.join(root, '.mcp.json'))) found.push('.mcp.json');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8'));
  if (manifest.mcpServers !== undefined) found.push('plugin.json mcpServers');
  return found;
}

test('the plugin declares no MCP server', () => {
  assert.deepStrictEqual(bundledServers(ROOT), []);
});

test('control: a declared server is found in either place', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repeatable-no-server-'));
  try {
    fs.mkdirSync(path.join(dir, '.claude-plugin'));
    fs.writeFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'x', mcpServers: {} }));
    fs.writeFileSync(path.join(dir, '.mcp.json'), '{"mcpServers":{}}');
    assert.deepStrictEqual(bundledServers(dir), ['.mcp.json', 'plugin.json mcpServers']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
