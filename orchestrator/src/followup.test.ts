import test from 'node:test';
import assert from 'node:assert/strict';
import { watchUntilUp, describeFollowup, shouldFollowUp, type Clock } from './followup.ts';
import type { AgentResult } from './agent-client.ts';
import type { ServerState } from '@reveille/contract';

const reached = (status: number, state: ServerState): AgentResult => ({
  reached: true,
  status,
  body: { state },
});

/** A clock where sleeping advances virtual time — so timeouts resolve instantly. */
function fakeClock(): Clock {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

test('a start that reaches running before the bound is confirmed up (US3)', async () => {
  let calls = 0;
  const status = async (): Promise<AgentResult> => reached(200, ++calls >= 3 ? 'running' : 'starting');
  const up = await watchUntilUp(status, 120_000, fakeClock(), 3_000);
  assert.equal(up, true);
  assert.ok(calls >= 3, 'stopped polling before it saw running');
});

test('a start that never comes up is "could not confirm", never "failed" (FR-029)', async () => {
  const status = async (): Promise<AgentResult> => reached(200, 'starting');
  const up = await watchUntilUp(status, 10_000, fakeClock(), 3_000);
  assert.equal(up, false);

  const reply = describeFollowup('satisfactory', up);
  assert.notEqual(reply.tone, 'failed', 'a timeout must never read as a failure');
  assert.match(reply.text, /confirm/i);
});

test('an unreachable blip during the wait is not "up"; a later running still confirms', async () => {
  let calls = 0;
  const status = async (): Promise<AgentResult> =>
    ++calls >= 2 ? reached(200, 'running') : { reached: false, reason: 'ECONNREFUSED' };
  const up = await watchUntilUp(status, 60_000, fakeClock(), 1_000);
  assert.equal(up, true);
});

test('the follow-up always names its server (FR-031)', () => {
  assert.match(describeFollowup('satisfactory', true).text, /Satisfactory/);
  assert.match(describeFollowup('satisfactory', false).text, /Satisfactory/);
  assert.equal(describeFollowup('palworld', true).tone, 'ok');
});

test('only an actual launch arms a follow-up — refusals and unreachable do not (FR-030)', () => {
  assert.equal(shouldFollowUp(reached(202, 'starting')), true, 'a 202 launch should follow up');
  assert.equal(shouldFollowUp(reached(409, 'running')), false, 'already running');
  assert.equal(shouldFollowUp(reached(409, 'starting')), false, 'start already in progress');
  assert.equal(shouldFollowUp(reached(500, 'error')), false, 'host-side failure');
  assert.equal(shouldFollowUp({ reached: false, reason: 'x' }), false, 'unreachable host');
  assert.equal(shouldFollowUp(undefined), false, 'unknown server name launched nothing');
});

test('the pending wait is in-memory only — no persistence surface to survive a restart (FR-032)', async () => {
  // A follow-up is a local async in armFollowup; the module keeps no registry or
  // store of pending waits, so a fresh process has nothing pending.
  const module = await import('./followup.ts');
  for (const name of Object.keys(module)) {
    assert.doesNotMatch(name, /pending|registry|store|persist|save/i, `${name} looks like persisted state`);
  }
});
