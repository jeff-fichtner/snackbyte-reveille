import test from 'node:test';
import assert from 'node:assert/strict';
import { describeStart, describeStop } from './commands.ts';
import type { AgentResult } from './agent-client.ts';
import type { AgentResponse } from '@reveille/contract';

const reached = (status: number, body: AgentResponse): AgentResult => ({
  reached: true,
  status,
  body,
});

test('202 and 409 both carry state `starting` and MUST read differently', () => {
  const launched = describeStart(reached(202, { state: 'starting' }));
  const refused = describeStart(reached(409, { state: 'starting' }));

  assert.notEqual(launched, refused, 'action-taken and already-in-that-state read identically');
  assert.match(launched, /Starting the server/);
  assert.match(refused, /already in progress/i);
  assert.match(refused, /nothing was launched/i);
});

test('a start never claims the server is up (FR-004)', () => {
  const msg = describeStart(reached(202, { state: 'starting' }));
  assert.match(msg, /launched, not verified/i);
  assert.doesNotMatch(msg, /\bis (now )?(up|running|online|ready)\b/i);
});

test('already running is reported as no-op', () => {
  const msg = describeStart(reached(409, { state: 'running' }));
  assert.match(msg, /already running/i);
  assert.match(msg, /nothing was launched/i);
});

test('unreachable host reads differently from a host-side failure (FR-009)', () => {
  const unreachable = describeStart({ reached: false, reason: 'ECONNREFUSED' });
  const failed = describeStart(reached(500, { state: 'error', message: 'exe missing' }));

  assert.match(unreachable, /could not reach the host/i);
  assert.doesNotMatch(failed, /could not reach the host/i);
  assert.match(failed, /exe missing/);
});

test('a failed stop says the server is STILL RUNNING (FR-006)', () => {
  const msg = describeStop(reached(500, { state: 'error', message: 'save timed out' }));
  assert.match(msg, /still running/i);
  assert.match(msg, /save timed out/);
});

test('a successful stop states the world was saved (SC-002)', () => {
  assert.match(describeStop(reached(200, { state: 'stopped' })), /saved/i);
});

test('a stop during startup is refused, not queued (FR-017, FR-010)', () => {
  const msg = describeStop(reached(409, { state: 'starting' }));
  assert.match(msg, /refused/i);
  // Must not promise to stop it later — an unattended shutdown nobody commanded
  // is forbidden outright (FR-010).
  assert.doesNotMatch(msg, /\b(queued?|will stop|once it is up I)\b/i);
});

test('every branch produces a non-empty reply — no command leaves a player guessing (SC-004)', () => {
  const cases: AgentResult[] = [
    { reached: false, reason: 'boom' },
    reached(202, { state: 'starting' }),
    reached(409, { state: 'running' }),
    reached(409, { state: 'starting' }),
    reached(409, { state: 'stopped' }),
    reached(200, { state: 'stopped' }),
    reached(500, { state: 'error' }),
    reached(418, { state: 'error' }),
  ];
  for (const c of cases) {
    assert.ok(describeStart(c).trim().length > 0, `describeStart empty for ${JSON.stringify(c)}`);
    assert.ok(describeStop(c).trim().length > 0, `describeStop empty for ${JSON.stringify(c)}`);
  }
});
