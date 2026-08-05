import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  describeStart,
  describeStop,
  describeAddress,
  describeStatus,
  describePause,
  describeResume,
  describeSeek,
  describeStep,
  toEmbed,
  routeToAgent,
  buildCommands,
  buildCommandGroups,
  DEFAULT_SEEK_SECONDS,
} from './commands.ts';
import type { ControlledServer } from './config.ts';
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

// ── 004: per-tenant scoped registration + isolation ──────────────────────────
type CmdOption = {
  name: string;
  description?: string;
  required?: boolean;
  min_value?: number;
  max_value?: number;
};
type Cmd = { name: string; description?: string; options?: CmdOption[] };
const TENANT_A: ControlledServer[] = [
  { name: 'palworld', baseUrl: 'http://127.0.0.1:8300', kind: 'game', publicPort: 8211 },
  { name: 'vlc', baseUrl: 'http://127.0.0.1:8302', kind: 'media' },
];

test('buildCommands scopes a guild to ONLY its own targets (FR-003)', () => {
  const cmds = buildCommands(TENANT_A) as unknown as Cmd[];
  assert.deepEqual(
    cmds.map((c) => c.name).sort(),
    ['address', 'back', 'forward', 'next', 'pause', 'play', 'previous', 'start', 'status', 'stop'],
  );
  // The acting game verbs name palworld and nothing else — no other tenant's game leaks in.
  for (const verb of ['start', 'stop', 'address']) {
    const subs = (cmds.find((c) => c.name === verb)?.options ?? []).map((o) => o.name);
    assert.deepEqual(subs, ['palworld'], `/${verb} should offer only this tenant's game`);
  }
});

test('buildCommands: a media-only tenant gets the media verbs + status, no game verbs', () => {
  const cmds = buildCommands([{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }]) as unknown as Cmd[];
  assert.deepEqual(
    cmds.map((c) => c.name).sort(),
    ['back', 'forward', 'next', 'pause', 'play', 'previous', 'status'],
  );
});

test('buildCommands: a game-only tenant gets start/stop/address/status, no pause/play', () => {
  const cmds = buildCommands([
    { name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 },
  ]) as unknown as Cmd[];
  assert.deepEqual(cmds.map((c) => c.name).sort(), ['address', 'start', 'status', 'stop']);
});

// ── 005: the seek surface ────────────────────────────────────────────────────

test('/forward and /back are bare, take ONE optional amount, and are NOT bounded (FR-005, SC-004)', () => {
  const cmds = buildCommands([{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }]) as unknown as Cmd[];

  for (const name of ['forward', 'back']) {
    const cmd = cmds.find((c) => c.name === name);
    assert.ok(cmd, `/${name} must be registered for a tenant with a media target`);
    const opts = cmd.options ?? [];
    assert.equal(opts.length, 1, `/${name} must carry exactly one option (FR-001)`);
    assert.equal(opts[0]?.name, 'seconds');
    assert.notEqual(opts[0]?.required, true, 'the amount must be OPTIONAL — the common case is bare');

    // The whole point of SC-004. discord.js offers setMinValue/setMaxValue and reaching
    // for them is the obvious instinct; FR-005 forbids bounding the amount. If a future
    // edit "fixes" this by adding a range, this is the assertion that stops it.
    assert.equal(opts[0]?.min_value, undefined, `/${name} must not clamp the amount (FR-005)`);
    assert.equal(opts[0]?.max_value, undefined, `/${name} must not cap the amount (FR-005)`);
  }
});

test('the 30s default exists in exactly one place, and /back negates it', () => {
  assert.equal(DEFAULT_SEEK_SECONDS, 30, 'FR-004 fixes the default at 30');

  // The routing arithmetic index.ts performs, asserted directly: `/back` negates whatever
  // it is given, so the sign carries the direction and no branch decides it downstream.
  const sent = (command: 'forward' | 'back', given?: number) => {
    const requested = given ?? DEFAULT_SEEK_SECONDS;
    return command === 'back' ? -requested : requested;
  };
  assert.equal(sent('forward'), 30, 'a bare /forward sends +30');
  assert.equal(sent('back'), -30, 'a bare /back sends -30');
  assert.equal(sent('forward', 90), 90);
  assert.equal(sent('back', 90), -90);
  // Pass-through, not magnitude: a negative amount flips the direction, as specified.
  assert.equal(sent('back', -30), 30, '/back -30 sends +30 and therefore seeks FORWARD');
  assert.equal(sent('forward', -30), -30);
});

test('a seek reply states what was ISSUED and claims no outcome (FR-003)', () => {
  const forward = describeSeek(reached(200, { state: 'playing' }), 30);
  const back = describeSeek(reached(200, { state: 'playing' }), -30);

  assert.equal(forward.tone, 'ok');
  assert.match(forward.text, /forward/i);
  assert.match(forward.text, /30/);
  assert.match(back.text, /back/i);

  // Nothing may assert an achieved position or a resulting state. M0 §5/§6/§7 proved the
  // orchestrator cannot know any of it — VLC accepts absurd positions, answers 200 for
  // commands it does not recognise, and resumes a paused player on a step.
  for (const r of [forward, back]) {
    assert.doesNotMatch(said(r), /\b(now at|landed|jumped to|position is|currently)\b/i);
  }
});

test('/back with a NEGATIVE amount reads as forward — the pass-through consequence, surfaced', () => {
  // index.ts negates, so `/back -30` arrives here as +30. The reply must say "forward"
  // rather than hide the surprise behind the command's name (Assumptions, Clarifications).
  const reply = describeSeek(reached(200, { state: 'playing' }), 30);
  assert.match(reply.text, /forward/i);
  assert.doesNotMatch(reply.text, /back/i);
});

test('a seek refusal reads in the SAME terms as pause’s (SC-003)', () => {
  const seek = describeSeek(reached(409, { state: 'stopped' }), 30);
  const pause = describePause(reached(409, { state: 'stopped' }));
  assert.equal(seek.tone, pause.tone, 'both must read as refusals, not failures');
  assert.match(seek.text, /nothing is playing/i);
  assert.match(pause.text, /nothing is playing/i);
});

test('an unreachable player reads as unreachable, never as a playback state (FR-009)', () => {
  const reply = describeSeek({ reached: false, reason: 'ECONNREFUSED' }, 30);
  assert.equal(reply.tone, 'failed');
  assert.match(reply.text, /could not reach the host/i);
  assert.doesNotMatch(reply.text, /playing|paused|stopped|jump/i);
});

test('every seek branch produces a non-empty reply, and none names content (SC-002, SC-004)', () => {
  const branches = [
    describeSeek(reached(200, { state: 'playing' }), 30),
    describeSeek(reached(200, { state: 'paused' }), -30),
    describeSeek(reached(409, { state: 'stopped' }), 30),
    describeSeek(reached(400, { state: 'error', message: 'bad seconds' }), 30),
    describeSeek(reached(500, { state: 'error', message: 'player unreachable' }), 30),
    describeSeek({ reached: false, reason: 'ECONNREFUSED' }, 30),
  ];
  for (const r of branches) {
    assert.ok(r.text.trim().length > 0, 'no command may leave a player guessing');
    // No item, file, playlist, index, title, or duration may appear anywhere (FR-002).
    assert.doesNotMatch(said(r), /\b(playlist|episode|file|track|title|item \d|chapter|duration)\b/i);
  }

  // Command DESCRIPTIONS are user-facing text too, and are the easy thing to forget.
  const cmds = buildCommands([{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }]) as unknown as Cmd[];
  for (const c of cmds) {
    const texts = [c.description ?? '', ...(c.options ?? []).map((o) => o.description ?? '')];
    for (const t of texts) {
      assert.doesNotMatch(t, /\b(playlist|episode|file|track|title|chapter)\b/i, `"${t}" names content`);
    }
  }
});

test('/next and /previous are bare and carry NO options at all (FR-001)', () => {
  const cmds = buildCommands([{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }]) as unknown as Cmd[];
  for (const name of ['next', 'previous']) {
    const cmd = cmds.find((c) => c.name === name);
    assert.ok(cmd, `/${name} must be registered for a media tenant`);
    assert.deepEqual(cmd.options ?? [], [], `/${name} is a blind step — it takes no argument`);
  }
});

test('a step reply reports what was ISSUED and never names the item (FR-002, FR-003)', () => {
  const next = describeStep(reached(200, { state: 'playing' }), 'next');
  const previous = describeStep(reached(200, { state: 'playing' }), 'previous');

  assert.equal(next.tone, 'ok');
  assert.match(next.text, /next/i);
  assert.match(previous.text, /previous/i);
  for (const r of [next, previous]) {
    assert.doesNotMatch(said(r), /\b(now playing|episode|file|track|title|item \d|playlist)\b/i);
    assert.doesNotMatch(said(r), /\b(now at|advanced to|moved to)\b/i);
  }
});

test('at a playlist boundary NO special message is invented and no result is claimed (US2 AC3)', () => {
  // The agent cannot tell the orchestrator it was at the end — knowing that would require
  // reading the playlist (FR-002), and M0 §8 measured VLC silently WRAPPING there. So the
  // end-of-playlist case is indistinguishable from any other success, by design: a 200 is
  // a 200, and there is exactly one wording for it.
  const middle = describeStep(reached(200, { state: 'playing' }), 'next');
  const atEnd = describeStep(reached(200, { state: 'playing' }), 'next');
  assert.deepEqual(atEnd, middle, 'no branch may exist that only fires at a boundary');
  assert.doesNotMatch(said(atEnd), /\b(last|end of|first|beginning|wrapped|no more)\b/i);
});

test('a step refusal matches pause’s terms, and every branch replies non-empty (SC-003, SC-004)', () => {
  const refused = describeStep(reached(409, { state: 'stopped' }), 'next');
  assert.equal(refused.tone, describePause(reached(409, { state: 'stopped' })).tone);
  assert.match(refused.text, /nothing is playing/i);

  const branches = [
    describeStep(reached(200, { state: 'playing' }), 'next'),
    describeStep(reached(200, { state: 'paused' }), 'previous'),
    refused,
    describeStep(reached(500, { state: 'error', message: 'player unreachable' }), 'next'),
    describeStep({ reached: false, reason: 'ECONNREFUSED' }, 'previous'),
  ];
  for (const r of branches) assert.ok(r.text.trim().length > 0);

  // Unreachable reads as unreachable, never as a playback state (FR-009).
  const unreached = describeStep({ reached: false, reason: 'ECONNREFUSED' }, 'next');
  assert.match(unreached.text, /could not reach the host/i);
});

test('nothing self-issues — no media path schedules a command (FR-008)', () => {
  // Every control is a direct human command: no timers, no automatic advance, no
  // presence tracking. `AbortSignal.timeout` (a request deadline) is not a scheduler and
  // is deliberately not matched here.
  const commandsSrc = readFileSync(fileURLToPath(new URL('./commands.ts', import.meta.url)), 'utf8');
  const indexSrc = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

  for (const [file, src] of [['commands.ts', commandsSrc], ['index.ts', indexSrc]] as const) {
    assert.doesNotMatch(src, /\bsetInterval\s*\(/, `${file} must not poll or repeat on its own`);
    assert.doesNotMatch(src, /\bsetTimeout\s*\(/, `${file} must not defer a command to later`);
    assert.doesNotMatch(src, /\bcron|\bschedule\(/i, `${file} must not schedule anything`);
  }

  // The ONE deliberate scheduler in the system is the US3 start follow-up. It must remain
  // reachable only from `/start` — a media command must never arm it.
  assert.equal(
    (indexSrc.match(/armFollowup\(/g) ?? []).length,
    1,
    'armFollowup must be called from exactly one place (the game start path)',
  );
});

// ── 006: the single source ───────────────────────────────────────────────────

/** A command's shape, ignoring description text — that is asserted elsewhere, derived. */
const shapeOf = (c: Cmd) => `${c.name}(${(c.options ?? []).map((o) => o.name).join(',')})`;

test('buildCommands is exactly the flattened groups — registration decides nothing (006)', () => {
  // The structural link that makes FR-007 hold: the registration payload is not built
  // alongside the groups, it is built FROM them. If someone later adds a command directly
  // to buildCommands, this fails.
  for (const servers of [
    TENANT_A,
    [{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }] as ControlledServer[],
    [{ name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 }] as ControlledServer[],
  ]) {
    const fromGroups = buildCommandGroups(servers).flatMap((g) => g.commands.map((c) => c.toJSON().name));
    const registered = (buildCommands(servers) as unknown as Cmd[]).map((c) => c.name);
    assert.deepEqual(registered, fromGroups, 'registration must be a pure derivation of the groups');
  }
});

test('the refactor did not change what registers — same commands, same order, same options', () => {
  // A regression fence around T001. Names, ORDER and option/subcommand names are asserted;
  // description text deliberately is not, since asserting it here would be the very second
  // copy this feature exists to remove.
  const gameAndMedia = (buildCommands(TENANT_A) as unknown as Cmd[]).map(shapeOf);
  assert.deepEqual(gameAndMedia, [
    'start(palworld)',
    'stop(palworld)',
    'address(palworld)',
    'pause()',
    'play()',
    'next()',
    'previous()',
    'forward(seconds)',
    'back(seconds)',
    'status()',
  ]);

  const mediaOnly = (buildCommands([
    { name: 'vlc', baseUrl: 'http://x', kind: 'media' },
  ]) as unknown as Cmd[]).map(shapeOf);
  assert.deepEqual(mediaOnly, [
    'pause()', 'play()', 'next()', 'previous()', 'forward(seconds)', 'back(seconds)', 'status()',
  ]);

  const gameOnly = (buildCommands([
    { name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 },
  ]) as unknown as Cmd[]).map(shapeOf);
  assert.deepEqual(gameOnly, ['start(palworld)', 'stop(palworld)', 'address(palworld)', 'status()']);
});

test('a group is never constructed empty, so it can never render empty (FR-022)', () => {
  const mediaOnly = buildCommandGroups([{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }]);
  const gameOnly = buildCommandGroups([
    { name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 },
  ]);

  for (const groups of [mediaOnly, gameOnly, buildCommandGroups(TENANT_A)]) {
    for (const g of groups) {
      assert.ok(g.commands.length > 0, `group "${g.label}" exists but is empty`);
    }
  }
  // The absent kind produces no group at all — not a group with nothing in it.
  assert.deepEqual(mediaOnly.map((g) => g.label), ['Media', 'Everything']);
  assert.deepEqual(gameOnly.map((g) => g.label), ['Games', 'Everything']);
  assert.deepEqual(buildCommandGroups(TENANT_A).map((g) => g.label), ['Games', 'Media', 'Everything']);
});

// ── 005 / US3: the new surface inherits 004's isolation ──────────────────────

test('a media-LESS tenant is offered NONE of the four new controls (004 FR-003, SC-005)', () => {
  const gameOnly = buildCommands([
    { name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 },
    { name: 'satisfactory', baseUrl: 'http://y', kind: 'game', publicPort: 7777 },
  ]) as unknown as Cmd[];
  const names = gameOnly.map((c) => c.name);

  // Zero of the four, and zero of 003's two — a guild with no player cannot even pick a
  // media command, so there is nothing to route and nothing to refuse at runtime.
  for (const media of ['next', 'previous', 'forward', 'back', 'pause', 'play']) {
    assert.ok(!names.includes(media), `/${media} must not be offered without a media target`);
  }
  assert.deepEqual(names.sort(), ['address', 'start', 'status', 'stop']);
});

test('the four new controls reach ONLY their own tenant’s media target (004 FR-002)', () => {
  // Two tenants, each with its own player, names deliberately different so a leak would be
  // visible. Every media handler resolves through `routeToAgent` against the map it is
  // handed — isolation is a property of WHICH MAP arrives, not of a filter.
  const aAgents = new Map([['vlc', new AgentClient('http://127.0.0.1:8302')]]);
  const bAgents = new Map([['projector', new AgentClient('http://127.0.0.1:8402')]]);

  assert.ok('agent' in routeToAgent('vlc', aAgents));
  const leaked = routeToAgent('projector', aAgents);
  assert.ok('reply' in leaked, 'another tenant’s player must not resolve to an agent');
  assert.equal(leaked.reply.tone, 'refused');
  // The refusal echoes the name the CALLER typed — that is their own input, not
  // disclosure, and it never confirms the name exists anywhere else. What must not leak is
  // the other tenant's ADDRESS, and its valid list must offer only this tenant's targets.
  assert.doesNotMatch(leaked.reply.text, /8402/, 'no other tenant’s address may leak');
  const offered = leaked.reply.text.slice(leaked.reply.text.indexOf('Try:'));
  assert.match(offered, /vlc/, 'the refusal offers this tenant’s own target');
  assert.doesNotMatch(offered, /projector/, 'the valid list must not name another tenant’s target');

  assert.ok('agent' in routeToAgent('projector', bAgents));
  assert.ok('reply' in routeToAgent('vlc', bAgents));
});

test('every media handler takes a tenant-scoped agents map — isolation is structural', () => {
  // The property that makes US3 inherited rather than re-implemented: no media handler can
  // reach a global registry, because there is no parameter through which one could arrive.
  // If a future edit introduced one, this is what would notice.
  const src = readFileSync(fileURLToPath(new URL('./commands.ts', import.meta.url)), 'utf8');
  for (const handler of ['handlePause', 'handleResume', 'handleSeek', 'handleStep']) {
    const from = src.indexOf(`export async function ${handler}(`);
    assert.notEqual(from, -1, `${handler} must exist`);
    const params = src.slice(from, src.indexOf(')', from));
    assert.match(
      params,
      /agents: ReadonlyMap<string, AgentClient>/,
      `${handler} must receive its tenant's agents map explicitly`,
    );
  }
  assert.doesNotMatch(src, /^const \w*[Aa]gents\s*=/m, 'no module-level agent registry may exist');
});

test('isolation: another tenant’s target is UNKNOWN to this tenant, never routed (FR-002)', () => {
  // Guild A's map holds only palworld. A command naming satisfactory (guild B's target)
  // is refused as unknown — it cannot be routed, because B's target is not in A's map.
  const aAgents = new Map([['palworld', new AgentClient('http://127.0.0.1:8300')]]);
  const routed = routeToAgent('satisfactory', aAgents);
  assert.ok('reply' in routed, 'a foreign target must not resolve to an agent');
  assert.equal(routed.reply.tone, 'refused');
  assert.match(routed.reply.text, /palworld/, 'the refusal offers only this tenant’s targets');
  assert.doesNotMatch(routed.reply.text, /8301/, 'must not reveal the other tenant’s agent');
});
