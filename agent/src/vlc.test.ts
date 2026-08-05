import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createVlcAdapter } from './vlc.ts';
import type { VlcConfig } from './config.ts';

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

test('no content SELECTION, playlist manipulation, or volume control (FR-004, narrowed by DECISIONS 022)', () => {
  // 005 moved this line from "no MOVEMENT through content" to "no KNOWLEDGE of
  // content". What stays banned is everything that requires knowing what is loaded:
  // naming an item, browsing, enqueuing, removing, or jumping to a nominated one.
  const forbidden = [
    /pl_play\b/, // play a specific playlist id
    /in_play\b/, // load and play an item
    /in_enqueue\b/, // add an item to the playlist
    /pl_empty\b/, // clear the playlist
    /pl_delete\b/, // remove an item
    /pl_jump\b/, // jump to a NOMINATED item — the sharpest contrast with pl_next
    /pl_next\b/,
    /pl_previous\b/,
    /pl_stop\b/, // stop is a lifecycle verb, not a pause
    /[?&]command=volume/, // volume
  ];
  for (const banned of forbidden) {
    assert.doesNotMatch(code, banned, `${banned} needs knowledge of content, which the adapter must not have`);
  }
});

test('seek is RELATIVE only — the absolute form is banned (FR-011, M0 §3)', () => {
  // THE measured trap. M0 §3: the sign prefix is what makes a seek relative.
  // `val=%2B30` moves +30s, `val=-30` moves -30s, but a bare `val=30` is an
  // ABSOLUTE seek to 0:30 — which would look plausible while doing the wrong thing.
  // So: positives must be explicitly encoded, and no unsigned value may appear.
  assert.match(code, /%2B/, 'a positive seek must send an explicit, percent-encoded plus (M0 §3/§4)');
  assert.doesNotMatch(code, /val=\d/, 'a literal unsigned val= is an ABSOLUTE seek (M0 §3)');
  assert.doesNotMatch(
    code,
    /val=\$\{\s*seconds\s*\}/,
    'interpolating the raw amount drops the sign for positives — that is an absolute seek',
  );
});

test('uses the FORCE pause/resume commands, not the toggle (M0 §4)', () => {
  // pl_pause toggles — it would flip the wrong way on a stale read. Forcing the
  // target state is idempotent, which the server's already-in-state no-op relies on.
  assert.match(code, /\bpl_forcepause\b/, 'pause must force, not toggle');
  assert.match(code, /\bpl_forceresume\b/, 'resume must force, not toggle');
  assert.doesNotMatch(code, /['"`]pl_pause['"`]/, 'the ambiguous toggle command must not appear');
});

/**
 * Stand a throwaway HTTP server in for VLC and capture the EXACT request line the
 * adapter emits. Source bans prove a forbidden call is absent; only this proves the
 * permitted one is spelled the way M0 measured. No mocking of `fetch` — the adapter
 * makes a real request to a real socket, and its base URL is config, so pointing it
 * here needs no seam of its own.
 */
async function captureRequests(drive: (a: ReturnType<typeof createVlcAdapter>) => Promise<void>) {
  const seen: string[] = [];
  const server = createServer((req, res) => {
    seen.push(req.url ?? '');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ state: 'playing' }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const config: VlcConfig = {
    target: 'vlc',
    port: 0,
    vlcBaseUrl: `http://127.0.0.1:${port}`,
    vlcPassword: 'test-password',
  };
  try {
    await drive(createVlcAdapter(config));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return seen;
}

test('seek sends the exact relative wire form M0 measured (M0 §2/§3/§4)', async () => {
  const seen = await captureRequests(async (adapter) => {
    await adapter.seek(30);
    await adapter.seek(-30);
    await adapter.seek(0);
  });

  // `%2B`, never a raw `+`: a raw plus is form-encoded whitespace by spec. VLC happened
  // to tolerate it (M0 §4), but the most safety-critical character in the request must
  // not depend on one parser's leniency.
  assert.equal(seen[0], '/requests/status.json?command=seek&val=%2B30');
  assert.equal(seen[1], '/requests/status.json?command=seek&val=-30');
  // Zero is still signed — an unsigned `val=0` would seek absolutely to the start.
  assert.equal(seen[2], '/requests/status.json?command=seek&val=%2B0');
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
