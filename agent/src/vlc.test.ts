import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createVlcAdapter } from './vlc.ts';
import type { VlcConfig } from './config.ts';

// The VLC adapter is the one file that could reach past its permitted verbs into
// killing a process or choosing content, so those bans are enforced against source
// rather than trusted to review — mirroring palworld.ts / satisfactory.ts
// (Constitution IV; FR-004, FR-011).
//
// 005 MOVED the line this file draws, and narrowed it in one dimension while
// tightening it in another (DECISIONS 022). It is no longer "the control plane toggles
// playback": the rule is now **no KNOWLEDGE of content**, not **no MOVEMENT through
// content**.
//
//   PERMITTED (new)   blind relative movement — `pl_next`, `pl_previous`, and a
//                     RELATIVE `seek`. Each needs to know nothing about what is loaded.
//   FORBIDDEN (still) anything requiring knowledge of content: `pl_jump` (a NOMINATED
//                     item — the sharpest contrast with `pl_next`), `pl_play`,
//                     `in_play`, `in_enqueue`, `pl_empty`, `pl_delete`; plus volume,
//                     `pl_stop`, and OS-level termination.
//   FORBIDDEN (new)   ABSOLUTE seek. M0 §3 measured a bare `val=30` seeking *to* 0:30
//                     rather than forward 30s — a silent, plausible-looking wrong
//                     action. Relative-vs-absolute is the only boundary 005 creates, so
//                     it is the one that must be machine-enforced (FR-011 mandates it).
//
// Source bans prove a forbidden call is ABSENT. They cannot prove the permitted one is
// spelled correctly, so the two behavioural tests below stand a throwaway HTTP server in
// for VLC and pin the exact request line the adapter emits.
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
    /pl_stop\b/, // stop is a lifecycle verb, not a pause
    /[?&]command=volume/, // volume
  ];
  for (const banned of forbidden) {
    assert.doesNotMatch(code, banned, `${banned} needs knowledge of content, which the adapter must not have`);
  }
});

test('blind stepping is REQUIRED; jumping to a nominated item stays banned (DECISIONS 022)', () => {
  // The whole narrowed line in one test. `pl_next`/`pl_previous` need to know NOTHING —
  // they are blind steps, so 005 permits them. `pl_jump` needs the playlist, so it stays
  // forbidden (asserted in the ban list above). That contrast IS the new boundary.
  assert.match(code, /pl_next\b/, 'stepping to the next item is permitted since DECISIONS 022');
  assert.match(code, /pl_previous\b/, 'stepping to the previous item is permitted since DECISIONS 022');
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
  // The stub ADVANCES on a step, like a real player, because the adapter now waits for the
  // switch to land before issuing the next one. A stub whose item never changes would make
  // every step wait out its full bound — and, worse, would let a loop that under-steps pass
  // (the real VLC bug: three rapid `pl_next` calls advanced the playlist by ONE, every
  // request answering 200).
  let plid = 1;
  const server = createServer((req, res) => {
    const url = req.url ?? '';
    seen.push(url);
    if (url.includes('command=pl_next') || url.includes('command=pl_previous')) plid++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ state: 'playing', currentplid: plid }));
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

test('next/previous send the bare step commands and NOTHING else (M0 §7)', async () => {
  const seen = await captureRequests(async (adapter) => {
    await adapter.next(1);
    await adapter.previous(1);
  });

  // No id, no index, no playlist read. The COUNT never reaches the wire either — VLC has
  // no "next times N", so a count of N is N identical bare requests (007 T025). What is
  // banned is knowledge of *which* item (FR-002); how many blind steps to take is a
  // parameter of the operation, which DECISIONS 023 admits and 024 confirms.
  const steps = seen.filter((u) => u.includes('command='));
  assert.equal(steps[0], '/requests/status.json?command=pl_next');
  assert.equal(steps[1], '/requests/status.json?command=pl_previous');
  assert.equal(steps.length, 2, 'one step each, and no extra commands');
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

test('007 T030 — a count of N issues EXACTLY N steps, unclamped (SC-008, FR-016)', async () => {
  // The property a wrong implementation still satisfies at count=1, which is why this is
  // worth its own test: one call looks identical whether the loop runs, is skipped, or
  // fires once regardless of N.
  for (const n of [1, 2, 3, 7, 40]) {
    const seen = await captureRequests(async (adapter) => {
      await adapter.next(n);
    });
    // Count the STEPS, not every request: the loop also reads to confirm each switch
    // landed. Those reads are the fix for the under-stepping bug, not noise.
    const steps = seen.filter((u) => u.includes('command=pl_next'));
    assert.equal(steps.length, n, `count ${n} must issue exactly ${n} steps`);
    for (const url of steps) {
      assert.equal(url, '/requests/status.json?command=pl_next');
    }
  }

  // Nothing is clamped, capped, or rounded down to something "sensible" (FR-016). 250 is
  // far past any plausible playlist, and that is the point — the player decides what a
  // step past the end means (M0 §8 measured it wrapping), never this code.
  const many = await captureRequests(async (adapter) => {
    await adapter.previous(250);
  });
  const manySteps = many.filter((u) => u.includes('command=pl_previous'));
  assert.equal(manySteps.length, 250, 'the count was clamped — FR-016 forbids any bound');
  assert.equal(new Set(manySteps).size, 1, 'every step must be the same bare command');
});

test('007 T030 — a count of zero steps zero times, with no special case (SC-008)', async () => {
  // Passed through exactly as given, like a seek of zero. The temptation is to treat 0 as
  // "they meant 1"; that would be an opinion about what the member intended.
  const seen = await captureRequests(async (adapter) => {
    await adapter.next(0);
  });
  assert.deepEqual(seen.filter((u) => u.includes('command=')), [], 'a count of zero must step zero times');
});

test('007 T030 — the count never reaches the wire, and no step names an item (FR-002)', async () => {
  const seen = await captureRequests(async (adapter) => {
    await adapter.next(5);
    await adapter.previous(5);
  });
  for (const url of seen.filter((u) => u.includes('command='))) {
    // VLC has no "next times N": N is N identical bare requests. Anything else in the
    // query would be knowledge of WHICH item, which stays forbidden (DECISIONS 024).
    assert.doesNotMatch(url, /count=|val=|id=|plid=|index=/, `a step carried a parameter: ${url}`);
  }
});

test('007 T015 — the adapter STORES nothing about content between calls (FR-011, SC-006)', () => {
  // The selection ban above is a source scan; it cannot prove statelessness, because a
  // cache is spelled with perfectly ordinary words. This asserts the shape instead: the
  // module holds no mutable top-level state for a reading to be kept in.
  assert.doesNotMatch(code, /^\s*let\s+\w+/m, 'a module-level `let` is somewhere to remember a reading');
  assert.doesNotMatch(code, /new (Map|Set|WeakMap)/, 'a collection here would be a cache of what was seen');
  assert.doesNotMatch(code, /last(Seen|Title|State|Known)/i, 'a "last seen" is exactly what FR-011 forbids');
});

test('007 T015 — OBSERVING is permitted and required; the traps stay avoided (DECISIONS 024)', () => {
  // The correction, asserted positively. Before 007 the requirement text banned reading
  // outright, and a test enforced it — so this is the assertion that replaces that one.
  assert.match(code, /information/, 'reading what the player reports is permitted since DECISIONS 024');
  assert.match(code, /meta/, 'the measured path is information.category.meta');

  // Trap 1 (m0-vlc-metadata.md §3): `information.title` is an integer INDEX, measured 0.
  // Reading it would yield a number that renders as a plausible name.
  assert.doesNotMatch(
    code,
    /information\s*\.\s*title|information\?\.\s*title|\[.information.\]\s*\.\s*title/,
    'information.title is a title INDEX, not a name — the name is at information.category.meta.title',
  );
});

test('007 verify — a failed read while settling does not fail a step that already happened', async () => {
  // The command is issued BEFORE the wait, so a read that throws mid-settle says nothing
  // about whether the step landed. Letting it propagate turned a completed multi-step into
  // a 500 and told the member "couldn't skip" about something that did.
  let hits = 0;
  const server = createServer((req, res) => {
    hits++;
    // Fail every read that follows the step command; the step itself succeeds.
    if (!(req.url ?? '').includes('command=') && hits % 2 === 0) {
      res.destroy();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ state: 'playing', currentplid: hits }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const adapter = createVlcAdapter({
    target: 'vlc', port: 0, vlcBaseUrl: `http://127.0.0.1:${port}`, vlcPassword: 'test-password',
  } as VlcConfig);

  try {
    // Must RESOLVE. Before the fix this rejected, and the caller turned that into a 500.
    await adapter.next(1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
