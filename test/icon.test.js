'use strict';

// The plugin carries the Tallyfy icon (#21).
//
// The Claude directory takes a plugin's listing icon only the first time it
// is saved or submitted in the portal, so the icon must be present before
// that and stay valid: a square PNG of 512 to 2048 px, under 2 MB.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ICON = path.join(__dirname, '..', '.claude-plugin', 'icon.png');

function pngSize(file) {
  if (!fs.existsSync(file)) return null;
  const buf = fs.readFileSync(file);
  if (buf.length < 24 || buf.toString('latin1', 1, 4) !== 'PNG' || buf.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), bytes: buf.length };
}

test('the plugin carries a square PNG icon the directory accepts', () => {
  const size = pngSize(ICON);
  assert.ok(size, '.claude-plugin/icon.png is missing or not a PNG');
  assert.strictEqual(size.width, size.height, 'icon must be square');
  assert.ok(size.width >= 512 && size.width <= 2048, 'icon is ' + size.width + ' px');
  assert.ok(size.bytes < 2 * 1024 * 1024, 'icon is ' + size.bytes + ' bytes');
});

test('control: a file that is not a PNG is rejected', () => {
  assert.strictEqual(pngSize(path.join(__dirname, '..', 'README.md')), null);
});
