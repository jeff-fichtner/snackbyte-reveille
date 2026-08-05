import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeStart,
  describeStop,
  describeAddress,
  describeStatus,
  describePause,
  describeResume,
  toEmbed,
  routeToAgent,
} from './commands.ts';
import { AgentClient, type AgentResult } from './agent-client.ts';
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
  // The words carry the honesty, and they are what this guards. `ok` says the
  // COMMAND succeeded — the launch was issued without error — not that the server
  // is up, which is precisely what the text and footnote go on to disclaim.
  assert.match(said(r), /launched, not verified/i);
  assert.doesNotMatch(said(r), /\bis (now )?(up|running|online|ready)\b/i);
});

test('a start reads as in progress and promises the follow-up (US3)', () => {
  // US3 inverts the old rule: a launch DOES get followed up on, so the immediate
  // reply pends (amber) and says another message will come — no longer terminal.
  const r = describeStart(reached(202, { state: 'starting' }));
  assert.equal(r.tone, 'progress');
  assert.match(r.text, /post again|follow/i);
});

test('nothing that failed or was refused reads as success', () => {
  for (const r of [
    describeStart(reached(409, { state: 'running' })),
    describeStart(reached(409, { state: 'starting' })),
    describeStart(reached(500, { state: 'error' })),
    describeStop(reached(409, { state: 'stopped' })),
    describeStop(reached(409, { state: 'starting' })),
    describeStop(reached(500, { state: 'error' })),
    describeStart({ reached: false, reason: 'x' }),
    describeStop({ reached: false, reason: 'x' }),
  ]) {
    assert.notEqual(r.tone, 'ok', `"${r.text}" must not read as success`);
  }
  // And the two that genuinely did something: a start now PENDS (US3 follows up),
  // a stop is terminal success. Neither reads as a failure.
  assert.equal(describeStart(reached(202, { state: 'starting' })).tone, 'progress');
  assert.equal(describeStop(reached(200, { state: 'stopped' })).tone, 'ok');
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

test('/address reports the looked-up IP with the configured port', () => {
  const r = describeAddress({ ip: '203.0.113.7' }, 8211);
  assert.match(r.text, /203\.0\.113\.7:8211/);
  assert.equal(r.tone, 'ok');
  // The port is configured, not assumed — a different game's port formats the same.
  assert.match(describeAddress({ ip: '203.0.113.7' }, 27015).text, /203\.0\.113\.7:27015/);
});

test('/address fails honestly when the IP cannot be determined', () => {
  const r = describeAddress({ error: 'No IP-lookup service responded.' }, 8211);
  assert.equal(r.tone, 'failed');
  assert.doesNotMatch(r.text, /\d+\.\d+\.\d+\.\d+/, 'must not invent an address');
  assert.match(r.footnote ?? '', /responded/);
});

test('/status reports every server with its own state, independently (SC-005)', () => {
  const r = describeStatus([
    { name: 'palworld', result: reached(200, { state: 'running' }) },
    { name: 'satisfactory', result: reached(200, { state: 'stopped' }) },
  ]);
  assert.equal(r.tone, 'ok');
  assert.match(r.text, /Palworld.*running/);
  assert.match(r.text, /Satisfactory.*stopped/);
});

test('/status shows an unreachable agent as such, others still reported (FR-023, FR-026)', () => {
  const r = describeStatus([
    { name: 'palworld', result: reached(200, { state: 'running' }) },
    { name: 'satisfactory', result: { reached: false, reason: 'ECONNREFUSED' } },
  ]);
  assert.match(r.text, /Palworld.*running/, 'a reachable server is still reported');
  assert.match(r.text, /Satisfactory.*unreachable/i, 'the down agent is unreachable, not a state');
});

test('/status folds a media target in its own vocabulary, alongside the games (US2)', () => {
  const r = describeStatus([
    { name: 'palworld', result: reached(200, { state: 'running' }) },
    { name: 'vlc', result: reached(200, { state: 'paused' }) },
  ]);
  assert.equal(r.tone, 'ok');
  assert.match(r.text, /Palworld.*running/, 'the game is still rendered as before (FR-013)');
  assert.match(r.text, /VLC.*paused/, 'the media target reads in playback words, not game words');
  // A media state is never dressed up as a game state, or vice versa.
  assert.doesNotMatch(r.text, /VLC.*(running|starting)/i);
});

test('/status shows a closed media player as unreachable, distinct from stopped (FR-023/026)', () => {
  const down = describeStatus([{ name: 'vlc', result: { reached: false, reason: 'ECONNREFUSED' } }]);
  assert.match(down.text, /Vlc.*unreachable/i, 'a down media agent is unreachable, not a state');

  const stopped = describeStatus([{ name: 'vlc', result: reached(200, { state: 'stopped' }) }]);
  assert.match(stopped.text, /Vlc.*stopped/i, 'nothing loaded is stopped, a real state');
  assert.notEqual(down.text, stopped.text, 'unreachable and stopped must not read alike');
});

test('/status renders a player-closed 500 as unreachable, never the game word "error" (US2/AC4, FR-003)', () => {
  // Agent UP, VLC CLOSED — the common "control plane started, show not opened yet"
  // case. The agent's /status returns 500 error because VLC's web interface is gone.
  // That must read as unreachable (the player could not be reached), not "error", and
  // the game beside it must still report normally (FR-013).
  const r = describeStatus([
    { name: 'palworld', result: reached(200, { state: 'running' }) },
    { name: 'vlc', result: reached(500, { state: 'error', message: 'ECONNREFUSED' }) },
  ]);
  assert.match(r.text, /Palworld.*running/, 'the game still reports normally');
  assert.match(r.text, /Vlc.*unreachable/i, 'a closed player is unreachable');
  assert.doesNotMatch(r.text, /Vlc.*error/i, 'the game-only "error" word must not leak into media status');
});

test('the media target displays as VLC (all caps) while staying `vlc` internally', () => {
  // Display only — the internal name is still lowercase `vlc` (routing/config), but a
  // human reads VLC. Case-sensitive on purpose: "Vlc" is the bug being prevented.
  const status = describeStatus([{ name: 'vlc', result: reached(200, { state: 'paused' }) }]);
  assert.match(status.text, /\bVLC\b/, 'status must read VLC, all caps');
  assert.doesNotMatch(status.text, /\bVlc\b/, 'a plain title-case "Vlc" must not leak through');

  // The /pause reply's embed title names the target too — also VLC.
  const title = toEmbed(describePause(reached(200, { state: 'paused' })), 'vlc').toJSON().title;
  assert.equal(title, 'VLC');
  // A normal name is unaffected — still plain title-case.
  assert.equal(toEmbed(describeStop(reached(200, { state: 'stopped' })), 'satisfactory').toJSON().title, 'Satisfactory');
});

test('/status never says who or how many are connected (FR-011)', () => {
  const r = describeStatus([{ name: 'palworld', result: reached(200, { state: 'running' }) }]);
  assert.doesNotMatch(r.text, /player|connected|online|\b\d+\s*\/\s*\d+\b/i);
});

test('routeToAgent reaches exactly the named server and no other (FR-021)', () => {
  const pal = new AgentClient('http://127.0.0.1:8300');
  const sat = new AgentClient('http://127.0.0.1:8301');
  const agents = new Map([
    ['palworld', pal],
    ['satisfactory', sat],
  ]);

  const toPal = routeToAgent('palworld', agents);
  assert.ok('agent' in toPal && toPal.agent === pal, 'palworld routed to the wrong client');
  const toSat = routeToAgent('satisfactory', agents);
  assert.ok('agent' in toSat && toSat.agent === sat, 'satisfactory routed to the wrong client');
});

test('an unknown server name is refused with the valid list, never routed (FR-020)', () => {
  const agents = new Map([['palworld', new AgentClient('http://127.0.0.1:8300')]]);
  const r = routeToAgent('minecraft', agents);
  assert.ok('reply' in r, 'an unknown name resolved to an agent');
  assert.equal(r.reply.tone, 'refused');
  assert.match(r.reply.text, /minecraft/, 'does not name the bad target');
  assert.match(r.reply.text, /palworld/, 'does not offer the valid list');
});

test('a pause that acted reads as done; a no-op reads as a no-op, not a failure (FR-007)', () => {
  const acted = describePause(reached(200, { state: 'paused' }));
  assert.equal(acted.tone, 'ok');
  assert.match(acted.text, /paused/i);

  // The agent reports an already-paused as a 200 with a message — it is a reported
  // no-op, NOT a failure. It must read as ok, and carry the agent's own words.
  const noop = describePause(reached(200, { state: 'paused', message: 'Already paused.' }));
  assert.equal(noop.tone, 'ok', 'a no-op must not read as a failure');
  assert.match(noop.text, /already paused/i);
});

test('a pause with nothing playing is refused honestly, never faked (FR-008)', () => {
  const r = describePause(reached(409, { state: 'stopped' }));
  assert.equal(r.tone, 'refused');
  assert.match(r.text, /nothing is playing/i);
  assert.notEqual(r.tone, 'ok', 'refusing to pause nothing must not read as success');
});

test('resume mirrors pause: acted, no-op, and nothing-loaded each read correctly', () => {
  assert.equal(describeResume(reached(200, { state: 'playing' })).tone, 'ok');
  assert.match(describeResume(reached(200, { state: 'playing' })).text, /playing/i);

  const noop = describeResume(reached(200, { state: 'playing', message: 'Already playing.' }));
  assert.equal(noop.tone, 'ok');
  assert.match(noop.text, /already playing/i);

  const refused = describeResume(reached(409, { state: 'stopped' }));
  assert.equal(refused.tone, 'refused');
  assert.match(refused.text, /nothing is loaded/i);
});

test('an unreachable media host reads as unreachable, not a playback state (FR-009)', () => {
  for (const r of [
    describePause({ reached: false, reason: 'ECONNREFUSED' }),
    describeResume({ reached: false, reason: 'ECONNREFUSED' }),
  ]) {
    assert.equal(r.tone, 'failed');
    assert.match(r.text, /could not reach the host/i);
    assert.doesNotMatch(r.text, /\b(playing|paused|stopped)\b/i, 'must not report a state it never got');
  }
});

test('every pause/resume branch produces a non-empty reply (SC-004)', () => {
  const cases: AgentResult[] = [
    { reached: false, reason: 'boom' },
    reached(200, { state: 'paused' }),
    reached(200, { state: 'paused', message: 'Already paused.' }),
    reached(409, { state: 'stopped' }),
    reached(500, { state: 'error', message: 'vlc web interface returned HTTP 500' }),
  ];
  for (const c of cases) {
    for (const r of [describePause(c), describeResume(c)]) {
      assert.ok(r.text.trim().length > 0, `empty text for ${JSON.stringify(c)}`);
      assert.ok(TONES.includes(r.tone), `bad tone for ${JSON.stringify(c)}`);
    }
  }
});

test('a media command routes to the media agent only, never a game agent (FR-021)', () => {
  const pal = new AgentClient('http://127.0.0.1:8300');
  const vlc = new AgentClient('http://127.0.0.1:8302');
  const agents = new Map([
    ['palworld', pal],
    ['vlc', vlc],
  ]);
  const routed = routeToAgent('vlc', agents);
  assert.ok('agent' in routed && routed.agent === vlc, 'a media command reached the wrong agent');
  assert.ok(routed.agent !== pal, 'a media command must not touch a game agent');
});

test('the reply names the server it acted on, in the embed title (FR-018)', () => {
  const embed = toEmbed(describeStart(reached(202, { state: 'starting' })), 'satisfactory').toJSON();
  assert.equal(embed.title, 'Satisfactory');
  // Without a server name (nothing to title), no title is invented.
  assert.equal(toEmbed(describeStart(reached(202, { state: 'starting' }))).toJSON().title, undefined);
});

test('the embed carries the text, and the footnote only when there is one', () => {
  const withNote = toEmbed(describeStart(reached(202, { state: 'starting' }))).toJSON();
  assert.match(withNote.description ?? '', /Starting the server/);
  assert.match(withNote.footer?.text ?? '', /not verified/i);
  assert.equal(withNote.color, 0xe8a13a); // progress/amber — a start pends (US3)

  const without = toEmbed(describeStart(reached(409, { state: 'running' }))).toJSON();
  assert.equal(without.footer, undefined, 'a footer appeared with no footnote to put in it');
});
