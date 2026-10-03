/**
 * Resolve an eas.json build profile the way EAS does for `extends`: the
 * parent chain is applied first, the child's keys win, and `env` objects are
 * merged (child values override parent values). Used by the OTA publish
 * guard, the config validator and the release-env check so all three read the
 * same effective profile (e.g. `clinic` extends `production`).
 *
 *   const { loadEas, resolveProfile, channelProfiles } = require('./eas-profile');
 */
'use strict';
/* eslint-disable @typescript-eslint/no-var-requires -- CommonJS node script */
const fs = require('fs');
const path = require('path');

function loadEas(root) {
  const p = path.join(root, 'eas.json');
  let text;
  try {
    text = fs.readFileSync(p, 'utf8');
  } catch {
    throw new Error(`eas.json was not found in ${root}. Fix: run from the repository root.`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`eas.json is not valid JSON (${err.message}). Fix: correct eas.json, then re-run.`);
  }
}

/** Effective profile `name` with `extends` applied. Throws on a missing profile or a cycle. */
function resolveProfile(eas, name, seen = []) {
  const build = (eas && eas.build) || {};
  const own = build[name];
  if (!own || typeof own !== 'object') {
    throw new Error(`eas.json has no build profile "${name}"${seen.length ? ` (extended by "${seen[seen.length - 1]}")` : ''}.`);
  }
  if (seen.includes(name)) {
    throw new Error(`eas.json build profiles extend each other in a loop: ${[...seen, name].join(' -> ')}.`);
  }
  const parent = own.extends ? resolveProfile(eas, own.extends, [...seen, name]) : {};
  const { extends: _ignored, ...rest } = own;
  return {
    ...parent,
    ...rest,
    env: { ...(parent.env || {}), ...(own.env || {}) },
  };
}

/** channel -> [profile names] for every profile whose effective config names a channel. */
function channelProfiles(eas) {
  const out = {};
  for (const name of Object.keys((eas && eas.build) || {})) {
    const p = resolveProfile(eas, name);
    if (typeof p.channel === 'string' && p.channel) {
      (out[p.channel] = out[p.channel] || []).push(name);
    }
  }
  return out;
}

module.exports = { loadEas, resolveProfile, channelProfiles };
