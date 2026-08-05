import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The VLC adapter is the one file that could reach past "toggle playback" into
// killing a process or choosing content, so those bans are enforced against source
// rather than trusted to review — mirroring palworld.ts / satisfactory.ts
// (Constitution IV; FR-004, FR-011, T011).
const source = readFileSync(fileURLToPath(new URL('./vlc.ts', import.meta.url)), 'utf8');

// Strip comments — they name the forbidden calls and commands to explain the bans.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
  .join('\n');

test('no OS-level process termination in the adapter (FR-011, Constitution IV)', () => {
  for (const forbidden of [/\bprocess\.kill\b/, /\.kill\s*\(/, /\btaskkill\b/, /\bStop-Process\b/]) {
    assert.doesNotMatch(code, forbidden, `${forbidden} would terminate VLC instead of pausing it`);
  }
});

test('no content selection, playlist, seek, or volume control (FR-004)', () => {
  // Reveille toggles playback of whatever the operator already loaded; it never
  // chooses or changes WHAT plays, or where within it, or how loud. Only the two
  // force play/pause commands are permitted (M0 §4).
  const forbidden = [
    /pl_play\b/, // play a specific playlist id
    /in_play\b/, // load and play an item
    /in_enqueue\b/, // add an item to the playlist
    /pl_empty\b/, // clear the playlist
    /pl_delete\b/, // remove an item
    /pl_jump\b/, // jump to an item
    /pl_next\b/,
    /pl_previous\b/,
    /pl_stop\b/, // stop is a lifecycle verb, not a pause
    /[?&]command=seek/, // scrubbing
    /[?&]command=volume/, // volume
  ];
  for (const banned of forbidden) {
    assert.doesNotMatch(code, banned, `${banned} is content/lifecycle control, not playback toggle`);
  }
});

test('uses the FORCE pause/resume commands, not the toggle (M0 §4)', () => {
  // pl_pause toggles — it would flip the wrong way on a stale read. Forcing the
  // target state is idempotent, which the server's already-in-state no-op relies on.
  assert.match(code, /\bpl_forcepause\b/, 'pause must force, not toggle');
  assert.match(code, /\bpl_forceresume\b/, 'resume must force, not toggle');
  assert.doesNotMatch(code, /['"`]pl_pause['"`]/, 'the ambiguous toggle command must not appear');
});

test('the request target is composed only from the configured (loopback) base URL', () => {
  // The adapter hardcodes NO host: every request is `${config.vlcBaseUrl}${path}`.
  // The host can therefore only ever be the configured base — which config + M0
  // constrain to 127.0.0.1. No absolute URL literal, and no `node:https` (plain HTTP
  // on loopback keeps the agent's zero-runtime-deps rule — TLS was Satisfactory-only).
  assert.match(code, /config\.vlcBaseUrl/, 'the base URL must come from config');
  assert.doesNotMatch(code, /https?:\/\//, 'no host may be hardcoded — the base is config-driven');
  assert.doesNotMatch(code, /node:https/, 'loopback HTTP needs no TLS module');
});
