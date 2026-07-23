'use strict';

// User configuration: defaults merged with config.json in the data dir.
// Owned by /repeatable:setup, hand-editable, versioned by config_version.

const fs = require('fs');
const path = require('path');
const paths = require('./paths');

const DEFAULTS = {
  config_version: 1,
  min_sessions: 3,
  min_days: 2,
  similarity: {
    prompt_jaccard: 0.5,
    tool_sequence: 0.6
  },
  ignore_projects: [],
  cross_project: false,
  trivial: {
    min_prompts: 1,
    min_duration_seconds: 60
  },
  tallyfy: {
    folder: null,
    tags: ['repeatable']
  }
};

function deepMerge(base, extra) {
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
    return extra === undefined ? base : extra;
  }
  const out = Object.assign({}, base);
  for (const k of Object.keys(extra)) {
    if (base && typeof base[k] === 'object' && !Array.isArray(base[k]) && base[k] !== null) {
      out[k] = deepMerge(base[k], extra[k]);
    } else {
      out[k] = extra[k];
    }
  }
  return out;
}

function load() {
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(paths.configPath(), 'utf8'));
  } catch (_) {
    user = {};
  }
  return deepMerge(DEFAULTS, user);
}

function save(config) {
  const p = paths.configPath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(config, null, 2) + '\n');
}

// Set a dot-path key, parsing the value as JSON when possible.
function set(dotPath, rawValue) {
  const config = load();
  let value;
  try {
    value = JSON.parse(rawValue);
  } catch (_) {
    value = rawValue;
  }
  const parts = dotPath.split('.');
  let node = config;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof node[parts[i]] !== 'object' || node[parts[i]] === null) node[parts[i]] = {};
    node = node[parts[i]];
  }
  node[parts[parts.length - 1]] = value;
  save(config);
  return config;
}

module.exports = { DEFAULTS, load, save, set, deepMerge };
