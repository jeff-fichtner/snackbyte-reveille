/**
 * The seam's own guarantees (007 T004).
 *
 * Two things are checked here, and neither is about behaviour — the contract has none.
 * They are the properties that make the seam safe to grow: that v5 is **additive**, so an
 * older agent still works, and that **no target identifier** has crept in (Constitution I).
 *
 * The additive check is deliberately a *type* assertion rather than a runtime one. There is
 * nothing to execute — `AgentResponse` is erased at runtime — so the guarantee lives in
 * whether `tsc` accepts a v4-shaped value. `npm run check:all` runs the typecheck, so a
 * regression fails the gate exactly as a failing assertion would.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { AgentResponse } from './index.ts';

/** A v4 response: every field that existed before 007, and none that did not. */
const v4Game = { state: 'running' } satisfies AgentResponse;
const v4GameWithMessage = { state: 'stopped', message: 'anything' } satisfies AgentResponse;
const v4Media = { state: 'paused' } satisfies AgentResponse;

/** A v5 response: the same, plus what a media agent may now observe. */
const v5Full = {
  state: 'playing',
  title: 'Whatever is loaded',
  elapsedSeconds: 724,
  totalSeconds: 2671,
} satisfies AgentResponse;

/** Each observation field is independently optional — a live stream has no total. */
const v5NoTotal = { state: 'playing', title: 'A stream', elapsedSeconds: 12 } satisfies AgentResponse;
const v5NoTitle = { state: 'playing', elapsedSeconds: 12, totalSeconds: 40 } satisfies AgentResponse;

test('v5 is additive: a v4-shaped response is still a valid AgentResponse (SC-011)', () => {
  // If any of these stopped type-checking, `tsc` would have failed before this ran. The
  // runtime assertions exist so the values are used and the intent is readable.
  for (const r of [v4Game, v4GameWithMessage, v4Media] satisfies AgentResponse[]) {
    assert.ok(typeof r.state === 'string');
    assert.equal(
      'title' in r || 'elapsedSeconds' in r || 'totalSeconds' in r,
      false,
      'a v4 response carries none of the v5 fields — that is what makes an older agent still work',
    );
  }
});

test('the v5 observation fields are each independently optional (FR-009)', () => {
  assert.equal(v5Full.totalSeconds, 2671);
  assert.equal('totalSeconds' in v5NoTotal, false, 'no total is absent, never zero (FR-009)');
  assert.equal('title' in v5NoTitle, false, 'no title is absent, never a placeholder (FR-009, SC-005)');
});

test('no target identifier may appear in the contract (Constitution I, FR-023)', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  // Only the declarations matter: prose in the header legitimately *names* the things it
  // forbids ("No server identifier ... may ever appear"), so scanning comments would flag
  // the very sentence that states the rule.
  const declarations = source
    .split('\n')
    .filter((line) => !/^\s*(\/\*|\*|\/\/)/.test(line))
    .join('\n');

  for (const forbidden of ['target', 'serverId', 'serverName', 'agentId', 'tenant', 'guild', 'kind', 'host', 'port']) {
    assert.equal(
      new RegExp(`\\b${forbidden}\\b`, 'i').test(declarations),
      false,
      `"${forbidden}" appears in a contract declaration — an agent's URL is its identity, so naming which target it is would be an architecture change, not a field`,
    );
  }
});

test('the seam declares no request payload — every verb stays a bare POST or a query (DECISIONS 023)', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.equal(
    /interface\s+\w*Request\b/.test(source),
    false,
    'a request type would mean a body crossed the seam; `seconds` and `count` are query parameters of the operation',
  );
});
