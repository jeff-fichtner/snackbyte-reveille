import test from 'node:test';
import assert from 'node:assert/strict';
import { describeStart, describeStop, toEmbed } from './commands.ts';
import type { AgentResult } from './agent-client.ts';
import type { AgentResponse } from '@reveille/contract';

const reached = (status: number, body: AgentResponse): AgentResult => ({
  reached: true,
  status,
  body,
});

/** Everything a player actually reads, text and small print together. */
const said = (r: { text: string; footnote?: string }) => `${r.text}\n${r.footnote ?? ''}`;

test('202 and 409 both carry state `starting` and MUST read differently', () => {
  const launched = describeStart(reached(202, { state: 'starting' }));
  const refused = describeStart(reached(409, { state: 'starting' }));

  assert.notEqual(launched.text, refused.text, 'action-taken and already-in-that-state read identically');
  assert.match(launched.text, /Starting the server/);
  assert.match(refused.text, /already in progress/i);
  assert.match(refused.text, /nothing was launched/i);
  assert.notEqual(launched.tone, refused.tone, 'the two must not look the same at a glance either');
});

test('a start never claims the server is up (FR-004)', () => {
  const r = describeStart(reached(202, { state: 'starting' }));
  assert.match(said(r), /launched, not verified/i);
  assert.doesNotMatch(said(r), /\bis (now )?(up|running|online|ready)\b/i);
  // Amber, not green: a launch was issued, nothing succeeded yet.
  assert.equal(r.tone, 'progress');
});

test('only a completed stop reads as success', () => {
  assert.equal(describeStop(reached(200, { state: 'stopped' })).tone, 'ok');
  for (const r of [
    describeStart(reached(202, { state: 'starting' })),
    describeStart(reached(409, { state: 'running' })),
    describeStop(reached(409, { state: 'starting' })),
    describeStart({ reached: false, reason: 'x' }),
  ]) {
    assert.notEqual(r.tone, 'ok', `"${r.text}" must not read as success`);
  }
});

test('already running is reported as no-op', () => {
  const r = describeStart(reached(409, { state: 'running' }));
  assert.match(r.text, /already running/i);
  assert.match(r.text, /nothing was launched/i);
});

test('unreachable host reads differently from a host-side failure (FR-009)', () => {
  const unreachable = describeStart({ reached: false, reason: 'ECONNREFUSED' });
  const failed = describeStart(reached(500, { state: 'error', message: 'exe missing' }));

  assert.match(unreachable.text, /could not reach the host/i);
  assert.doesNotMatch(failed.text, /could not reach the host/i);
  assert.match(said(failed), /exe missing/);
});

test('a failed stop says the server is STILL RUNNING in the text, not the small print (FR-006)', () => {
  const r = describeStop(reached(500, { state: 'error', message: 'save timed out' }));
  // Must be the headline, because a footnote is caveat-sized and this is not a caveat.
  assert.match(r.text, /still running/i);
  assert.match(said(r), /save timed out/);
});

test('a successful stop states the world was saved (SC-002)', () => {
  assert.match(describeStop(reached(200, { state: 'stopped' })).text, /saved/i);
});

test('a stop during startup is refused, not queued (FR-017, FR-010)', () => {
  const r = describeStop(reached(409, { state: 'starting' }));
  assert.match(r.text, /refused/i);
  assert.doesNotMatch(said(r), /\b(queued?|will stop)\b/i);
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
    for (const r of [describeStart(c), describeStop(c)]) {
      assert.ok(r.text.trim().length > 0, `empty text for ${JSON.stringify(c)}`);
      assert.ok(TONES.includes(r.tone), `bad tone for ${JSON.stringify(c)}`);
    }
  }
});
const TONES = ['progress', 'ok', 'refused', 'failed'];

test('colour never carries meaning the words do not', () => {
  // Colour is decoration. Strip it and every branch must still be unambiguous —
  // which is also what makes the replies readable to anyone who cannot see it.
  const all = [
    describeStart(reached(202, { state: 'starting' })),
    describeStart(reached(409, { state: 'running' })),
    describeStop(reached(200, { state: 'stopped' })),
    describeStop(reached(409, { state: 'starting' })),
    describeStop(reached(500, { state: 'error', message: 'x' })),
  ].map((r) => r.text);
  assert.equal(new Set(all).size, all.length, 'two branches are distinguishable only by colour');
});

test('the embed carries the text, and the footnote only when there is one', () => {
  const withNote = toEmbed(describeStart(reached(202, { state: 'starting' }))).toJSON();
  assert.match(withNote.description ?? '', /Starting the server/);
  assert.match(withNote.footer?.text ?? '', /not verified/i);
  assert.equal(withNote.color, 0xe8a13a);

  const without = toEmbed(describeStart(reached(409, { state: 'running' }))).toJSON();
  assert.equal(without.footer, undefined, 'a footer appeared with no footnote to put in it');
});
