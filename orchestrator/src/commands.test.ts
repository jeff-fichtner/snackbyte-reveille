import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SlashCommandBuilder } from 'discord.js';
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
  toCommandEntries,
  describeCommandList,
  DEFAULT_SEEK_SECONDS,
  DEFAULT_STEP_COUNT,
  NO_MEDIA_TARGET,
  runStart,
  runStop,
  runStatus,
  runPause,
  runResume,
  runSeek,
  runStep,
  runAddress,
  describeStopping,
  handleStop,
} from './commands.ts';
import { describeFollowup } from './followup.ts';
import type { ControlledServer } from './config.ts';
import { AgentClient, type AgentResult } from './agent-client.ts';
import type { AgentResponse } from '@reveille/contract';

const reached = (status: number, body: AgentResponse): AgentResult => ({
  reached: true,
  status,
  body,
});

/**
 * What the OPERATOR gets. Deliberately separate from `said`: 007 FR-005/FR-006 split one
 * string into two destinations, and a test that read them together could not tell the two
 * apart — which is how the leak survived this long.
 */
const logged = (r: { diagnostic?: string }) => r.diagnostic ?? '';

/** Everything a player actually reads, text and small print together. */
const said = (r: { text: string; footnote?: string }) => `${r.text}\n${r.footnote ?? ''}`;

/**
 * The unreachable branch, asserted as a PROPERTY rather than a phrase.
 *
 * Four tests used to pin the literal "could not reach the host", so rewording the reply
 * broke four of them and told us nothing useful. What actually matters is that it reads as
 * a failure, names no playback state it never observed, and leaks no internals.
 */
const readsAsUnreachable = (r: { tone: string; text: string; footnote?: string }) => {
  assert.equal(r.tone, 'failed');
  assert.doesNotMatch(said(r), /\b(playing|paused|stopped|running)\b/i, 'reports a state it never got');
  assert.doesNotMatch(said(r), /ECONNREFUSED|ETIMEDOUT|HTTP \d|\bagent\b/i, 'leaks an internal (FR-001, FR-002)');
  assert.ok(r.text.trim().length > 0);
};

test('202 and 409 both carry state `starting` and MUST read differently', () => {
  const launched = describeStart(reached(202, { state: 'starting' }));
  const refused = describeStart(reached(409, { state: 'starting' }));

  assert.notEqual(launched.text, refused.text, 'action-taken and already-in-that-state read identically');
  assert.match(launched.text, /starting it up/i);
  assert.match(refused.text, /already in progress/i);
  assert.match(refused.text, /nothing was launched/i);
  assert.notEqual(launched.tone, refused.tone, 'the two must not look the same at a glance either');
});

test('a start never claims the server is up (FR-004)', () => {
  const r = describeStart(reached(202, { state: 'starting' }));
  // The words carry the honesty, and they are what this guards. `ok` says the
  // COMMAND succeeded — the launch was issued without error — not that the server
  // is up, which is precisely what the text and footnote go on to disclaim.
  // The disclaimer used to say "launched, not verified" — mechanism. The guarantee is
  // what survives: promise a later answer, never claim the server is up.
  assert.match(said(r), /post again/i, 'must promise the follow-up rather than explain itself');
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

  readsAsUnreachable(unreachable);
  assert.notEqual(failed.text, unreachable.text, 'a host-side failure must not read as unreachable');
  // The agent's own words are the OPERATOR's, not the member's (FR-005).
  assert.doesNotMatch(said(failed), /exe missing/, "the target's text reached the channel");
  assert.match(logged(failed), /exe missing/, 'the detail must still reach the operator (SC-003)');
});

test('a failed stop says the server is STILL RUNNING in the text, not the small print (FR-006)', () => {
  const r = describeStop(reached(500, { state: 'error', message: 'save timed out' }));
  // Must be the headline, because a footnote is caveat-sized and this is not a caveat.
  assert.match(r.text, /still running/i);
  assert.doesNotMatch(said(r), /save timed out/, "the target's text reached the channel (FR-005)");
  assert.match(logged(r), /save timed out/, 'the detail must still reach the operator (SC-003)');
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
  assert.doesNotMatch(said(r), /responded/, 'the lookup detail is the operator’s, not the member’s');
  assert.match(logged(r), /responded/, 'and it must still reach them (SC-003)');
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
  // The agent still reports the no-op, but the ORCHESTRATOR authors the sentence (FR-005).
  // It reads the same either way, which is the point: a no-op is not a failure.
  const noop = describePause(reached(200, { state: 'paused', message: 'Already paused.' }));
  assert.equal(noop.tone, 'ok', 'a no-op must not read as a failure');
  assert.equal(noop.text, acted.text, "the agent's wording must not change what the member reads");
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
  assert.equal(noop.text, describeResume(reached(200, { state: 'playing' })).text);

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
    readsAsUnreachable(r);
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
  // `/address` carries the surviving footnote; `/start` no longer has one (007 T008).
  const withNote = toEmbed(describeAddress({ ip: '203.0.113.7' }, 8211)).toJSON();
  assert.match(withNote.description ?? '', /203\.0\.113\.7/);
  assert.match(withNote.footer?.text ?? '', /\S/, 'the footnote is missing from the embed');

  const progress = toEmbed(describeStart(reached(202, { state: 'starting' }))).toJSON();
  assert.equal(progress.color, 0xe8a13a); // progress/amber — a start pends (US3)

  const without = toEmbed(describeStart(reached(409, { state: 'running' }))).toJSON();
  assert.equal(without.footer, undefined, 'a footer appeared with no footnote to put in it');
});

// ── 004: per-tenant scoped registration + isolation ──────────────────────────
type CmdOption = {
  name: string;
  description?: string;
  /** Discord's option-type tag; `1` is a subcommand. */
  type?: number;
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
    ['address', 'back', 'forward', 'help', 'next', 'pause', 'play', 'previous', 'start', 'status', 'stop'],
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
    ['back', 'forward', 'help', 'next', 'pause', 'play', 'previous', 'status'],
  );
});

test('buildCommands: a game-only tenant gets start/stop/address/status, no pause/play', () => {
  const cmds = buildCommands([
    { name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 },
  ]) as unknown as Cmd[];
  assert.deepEqual(cmds.map((c) => c.name).sort(), ['address', 'help', 'start', 'status', 'stop']);
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
  readsAsUnreachable(reply);
  assert.doesNotMatch(reply.text, /jump/i);
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
    // 007 CORRECTS this assertion (DECISIONS 024). It used to ban "title" and "duration"
    // from a reply outright — the overshoot — and passed only because these branches
    // happen to carry no detail; it would have failed the moment a real reading arrived.
    // What the principle actually forbids is naming a NOMINATED item or offering a way to
    // choose one. Reporting what the player says is loaded is now permitted and required.
    assert.doesNotMatch(said(r), /\b(playlist|choose|select|queue|browse|item \d)\b/i, 'a reply offered content SELECTION');
  }

  // A reply MAY carry what the player reported — the correction, asserted positively so
  // nobody "restores" the old ban (SC-015).
  const withDetail = describeSeek(
    reached(200, { state: 'playing', title: 'Some Show', elapsedSeconds: 61, totalSeconds: 125 }),
    30,
  );
  assert.match(withDetail.text, /Some Show/, 'observing and reporting is permitted since DECISIONS 024');
  assert.match(withDetail.text, /1:01 \/ 2:05/);

  // Command DESCRIPTIONS are user-facing text too, and are the easy thing to forget.
  const cmds = buildCommands([{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }]) as unknown as Cmd[];
  for (const c of cmds) {
    const texts = [c.description ?? '', ...(c.options ?? []).map((o) => o.description ?? '')];
    for (const t of texts) {
      assert.doesNotMatch(t, /\b(playlist|episode|file|track|title|chapter)\b/i, `"${t}" names content`);
    }
  }
});

test('/next and /previous take ONE optional, UNBOUNDED count (007 FR-015, FR-016)', () => {
  // 005 asserted these were bare. 007 gives them a count — but the property that mattered
  // survives, sharpened: the option must be OPTIONAL (the common case stays argument-free)
  // and must carry NO bounds. A `min_value` would be fatal rather than merely wrong here,
  // because a NEGATIVE count is meaningful — it reverses direction (FR-017).
  const cmds = buildCommands([{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }]) as unknown as Cmd[];
  for (const name of ['next', 'previous']) {
    const cmd = cmds.find((c) => c.name === name);
    assert.ok(cmd, `/${name} must be registered for a media tenant`);
    const options = cmd.options ?? [];
    assert.equal(options.length, 1, `/${name} takes exactly one option`);
    const opt = (options as unknown as Record<string, unknown>[])[0] ?? {};
    assert.equal(opt.name, 'count');
    assert.notEqual(opt.required, true, 'the common case must stay argument-free');
    assert.equal(opt.min_value, undefined, 'a minimum would forbid the negative that reverses direction');
    assert.equal(opt.max_value, undefined, 'the count is unbounded (FR-016)');
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
  readsAsUnreachable(unreached);
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

test('the registered surface is exactly this — commands, order, and options', () => {
  // A regression fence: the T001 refactor must not have changed what registers, and
  // nothing may be added to the surface without this test noticing. (`/help` itself is a
  // deliberate addition by T003 and appears below.) Names, ORDER and option/subcommand
  // names are asserted; description text deliberately is not, since asserting it here
  // would be the very second copy this feature exists to remove.
  const gameAndMedia = (buildCommands(TENANT_A) as unknown as Cmd[]).map(shapeOf);
  assert.deepEqual(gameAndMedia, [
    'start(palworld)',
    'stop(palworld)',
    'address(palworld)',
    'pause()',
    'play()',
    'next(count)',
    'previous(count)',
    'forward(seconds)',
    'back(seconds)',
    'status()',
    'help()',
  ]);

  const mediaOnly = (buildCommands([
    { name: 'vlc', baseUrl: 'http://x', kind: 'media' },
  ]) as unknown as Cmd[]).map(shapeOf);
  assert.deepEqual(mediaOnly, [
    'pause()', 'play()', 'next(count)', 'previous(count)', 'forward(seconds)', 'back(seconds)', 'status()', 'help()',
  ]);

  const gameOnly = (buildCommands([
    { name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 },
  ]) as unknown as Cmd[]).map(shapeOf);
  assert.deepEqual(gameOnly, ['start(palworld)', 'stop(palworld)', 'address(palworld)', 'status()', 'help()']);
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

// ── 006 / US1: the listing ───────────────────────────────────────────────────

/**
 * The registered runnable forms, derived independently of the listing — by expanding the
 * REGISTRATION payload rather than the groups. Two derivations that must agree.
 */
function registeredForms(servers: ControlledServer[]): string[] {
  return (buildCommands(servers) as unknown as Cmd[]).flatMap((c) => {
    const opts = c.options ?? [];
    const subs = opts.filter((o) => o.type === 1);
    if (subs.length > 0) return subs.map((s) => `/${c.name} ${s.name}`);
    const args = opts.map((o) => (o.required === true ? `<${o.name}>` : `[${o.name}]`)).join(' ');
    return [args ? `/${c.name} ${args}` : `/${c.name}`];
  });
}

const listedForms = (servers: ControlledServer[]) =>
  buildCommandGroups(servers).flatMap((g) => g.commands.flatMap(toCommandEntries)).map((e) => e.form);

test('THE BIJECTION: the listing and the registered surface agree exactly (FR-007, SC-002)', () => {
  // The feature's correctness proof. Nothing listed that cannot be run, nothing runnable
  // that is missing — asserted derived-to-derived, from two independent expansions.
  //
  // Note what is NOT here: any expected string. A fixture of description text would be a
  // THIRD copy with exactly the drift problem the feature exists to remove, and it would
  // pass on the day it was written (005's `vlc.ts` header did too).
  for (const servers of [
    TENANT_A,
    [{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }] as ControlledServer[],
    [{ name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 }] as ControlledServer[],
    [
      { name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 },
      { name: 'satisfactory', baseUrl: 'http://y', kind: 'game', publicPort: 7777 },
      { name: 'vlc', baseUrl: 'http://z', kind: 'media' },
    ] as ControlledServer[],
  ]) {
    assert.deepEqual(listedForms(servers), registeredForms(servers), 'listing must equal the registered surface');
  }
});

test('every description is the REGISTERED one, never authored (FR-008, SC-003)', () => {
  // Read the expected text out of the registration payload rather than a literal, so this
  // test cannot itself become a stale copy. Change a registered description and the
  // listing follows with no edit here.
  const registered = new Map<string, string>();
  for (const c of buildCommands(TENANT_A) as unknown as Cmd[]) {
    const subs = (c.options ?? []).filter((o) => o.type === 1);
    if (subs.length > 0) for (const s of subs) registered.set(`/${c.name} ${s.name}`, s.description ?? '');
  }

  for (const e of buildCommandGroups(TENANT_A).flatMap((g) => g.commands.flatMap(toCommandEntries))) {
    const expected = registered.get(e.form);
    if (expected !== undefined) assert.equal(e.description, expected, `${e.form} must quote its registered description`);
  }
});

test('one entry per RUNNABLE form — /start yields one per game target, not one (FR-002)', () => {
  const forms = listedForms([
    { name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 },
    { name: 'satisfactory', baseUrl: 'http://y', kind: 'game', publicPort: 7777 },
  ]);
  assert.ok(forms.includes('/start palworld') && forms.includes('/start satisfactory'));
  assert.ok(!forms.includes('/start'), '/start alone is not runnable and must not be listed');
  // FR-012 falls out of this: the runnable form contains the target.
  assert.equal(forms.filter((f) => f.startsWith('/start')).length, 2);
});

test('an optional argument shows as optional, with its default visible (FR-003)', () => {
  const entries = buildCommandGroups([{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }])
    .flatMap((g) => g.commands.flatMap(toCommandEntries));
  const forward = entries.find((e) => e.form.startsWith('/forward'));
  assert.ok(forward, '/forward must be listed');
  assert.equal(forward.form, '/forward [seconds]', 'brackets mean optional');
  // The default is stated — and it comes from the registered option description, so this
  // asserts the number rather than the sentence carrying it.
  assert.match(forward.description, new RegExp(String(DEFAULT_SEEK_SECONDS)));
});

test('/help lists itself, and is offered to every tenant (FR-004)', () => {
  for (const servers of [
    TENANT_A,
    [{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }] as ControlledServer[],
    [{ name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 }] as ControlledServer[],
  ]) {
    assert.ok(listedForms(servers).includes('/help'), 'a list that omits itself is incomplete');
  }
});

test('the listing contacts nothing and describes no content (FR-013, FR-015, SC-006, SC-007)', () => {
  // Rendered with no AgentClient in existence at all — the listing says what may be ASKED
  // for, never whether it would succeed. It is identical however the targets are behaving.
  const reply = describeCommandList(buildCommandGroups(TENANT_A));
  assert.ok(reply.text.trim().length > 0);
  assert.doesNotMatch(
    reply.text,
    /\b(playlist|episode|file|track|title|chapter|duration|position)\b/i,
    'the listing must never describe content',
  );
});

// ── 006 / US2: the listing is about MY guild ─────────────────────────────────

test('the listing is scoped to the asking guild, with no empty headings (FR-010, SC-004)', () => {
  const mediaOnly = buildCommandGroups([{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }]);
  const gameOnly = buildCommandGroups([
    { name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 },
  ]);

  // A guild with no games is never shown a game command, and never shown a "Games"
  // heading with nothing beneath it — the group was never constructed (T001).
  assert.deepEqual(mediaOnly.map((g) => g.label), ['Media', 'Everything']);
  const mediaForms = mediaOnly.flatMap((g) => g.commands.flatMap(toCommandEntries)).map((e) => e.form);
  for (const gameVerb of ['/start', '/stop', '/address']) {
    assert.ok(!mediaForms.some((f) => f.startsWith(gameVerb)), `${gameVerb} must not be listed`);
  }

  assert.deepEqual(gameOnly.map((g) => g.label), ['Games', 'Everything']);
  const gameForms = gameOnly.flatMap((g) => g.commands.flatMap(toCommandEntries)).map((e) => e.form);
  for (const mediaVerb of ['/pause', '/play', '/next', '/previous', '/forward', '/back']) {
    assert.ok(!gameForms.some((f) => f.startsWith(mediaVerb)), `${mediaVerb} must not be listed`);
  }
});

test('one guild’s listing reveals nothing about another’s targets (FR-011, SC-005)', () => {
  // Isolation is structural: the listing is built from the tenant's OWN server list, so
  // another tenant's targets were never passed in and cannot appear.
  const a = describeCommandList(buildCommandGroups([
    { name: 'palworld', baseUrl: 'http://127.0.0.1:8300', kind: 'game', publicPort: 8211 },
  ]));
  const b = describeCommandList(buildCommandGroups([
    { name: 'projector', baseUrl: 'http://127.0.0.1:8402', kind: 'media' },
  ]));

  assert.doesNotMatch(a.text, /projector|8402/, 'A must not learn of B’s target');
  assert.doesNotMatch(b.text, /palworld|8300|8211/, 'B must not learn of A’s target');
  // ...and each does name its own, because the runnable form contains it (FR-012).
  assert.match(a.text, /palworld/);
});

// US2/AC4 (an unconfigured guild is ignored) needs no test of its own: the tenant is
// resolved in `interactionCreate` BEFORE `handle()` is called, so an unconfigured guild
// never reaches any command — `/help` included, wherever it sits inside `handle`. That is
// 004 FR-006, inherited rather than re-implemented. It is recorded here because the
// guarantee depends on that ordering surviving future edits.

// ── 006 / US3: the listing cannot go stale ───────────────────────────────────

test('adding or removing a target changes the listing, with no text edited (FR-009, SC-003)', () => {
  const withoutMedia: ControlledServer[] = [
    { name: 'palworld', baseUrl: 'http://x', kind: 'game', publicPort: 8211 },
  ];
  const withMedia: ControlledServer[] = [...withoutMedia, { name: 'vlc', baseUrl: 'http://y', kind: 'media' }];

  const before = listedForms(withoutMedia);
  const after = listedForms(withMedia);

  // The media commands appear purely because configuration changed — nothing in this
  // file, and no description anywhere, was edited to make it happen.
  assert.ok(!before.includes('/pause'));
  assert.ok(after.includes('/pause') && after.includes('/forward [seconds]'));
  // ...and removing the target takes them away again.
  assert.deepEqual(listedForms(withoutMedia), before);

  // A second game target adds its own runnable forms, without adding a command.
  const twoGames = listedForms([
    ...withoutMedia,
    { name: 'satisfactory', baseUrl: 'http://z', kind: 'game', publicPort: 7777 },
  ]);
  assert.ok(twoGames.includes('/start satisfactory'));
  assert.equal(twoGames.filter((f) => f.startsWith('/start')).length, 2);
});

test('a Discord hiccup cannot kill the process — handle() is never left unguarded (T014)', () => {
  // This is a regression fence around a crash that actually happened: a transient
  // `10062 Unknown interaction` from `deferReply` -- which runs OUTSIDE handle's own try --
  // propagated to `void handle(...)`, became an unhandled rejection, and terminated the
  // orchestrator under Node's default. A bot that dies on a Discord blip is not acceptable.
  const idx = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

  // Every `handle(...)` invocation must carry a rejection handler.
  const bare = idx.match(/void handle\([^)]*\)\s*;/g) ?? [];
  assert.deepEqual(bare, [], 'handle() must never be invoked without a .catch — an unhandled rejection exits the process');
  assert.match(idx, /void handle\([^)]*\)\.catch\(/, 'the interaction dispatch needs a rejection handler');

  // ...and the handler itself must not be able to throw, or it recreates the problem.
  const reporter = idx.slice(idx.indexOf('async function reportFailure'));
  assert.match(reporter.slice(0, reporter.indexOf('\n}')), /catch\s*\{/, 'reportFailure must swallow its own failure');
});

test('a subcommand group fails loudly rather than rendering nonsense (T015)', () => {
  // Nothing registers one today. The guard exists because the alternative is silent-wrong
  // output — `/media group` would render as `[group]` — and that is the exact failure this
  // feature exists to prevent. Better a loud error the moment someone adds one.
  const grouped = new SlashCommandBuilder().setName('media').setDescription('Media commands.');
  grouped.addSubcommandGroup((g) =>
    g.setName('seek').setDescription('Seek around.').addSubcommand((s) =>
      s.setName('forward').setDescription('Jump forward.'),
    ),
  );
  assert.throws(() => toCommandEntries(grouped), /subcommand group/i);
});

test('nothing self-issues — no listing is produced unasked (FR-016)', () => {
  const src = readFileSync(fileURLToPath(new URL('./commands.ts', import.meta.url)), 'utf8');
  const idx = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
  for (const [file, text] of [['commands.ts', src], ['index.ts', idx]] as const) {
    assert.doesNotMatch(text, /\bsetInterval\s*\(/, `${file} must not repeat on its own`);
    assert.doesNotMatch(text, /\bsetTimeout\s*\(/, `${file} must not defer work to later`);
  }
  assert.equal((idx.match(/armFollowup\(/g) ?? []).length, 1, 'the one scheduler stays in the start path');
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
  assert.deepEqual(names.sort(), ['address', 'help', 'start', 'status', 'stop']);
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

/**
 * 007 US1 — the three checks that make "the orchestrator authors every word" enforceable
 * rather than aspirational.
 *
 * All three are DERIVED: they enumerate every reply the code can produce and assert a
 * property of the whole set. None contains a fixture of expected wording, so rewording a
 * reply cannot break them and — more importantly — cannot sneak past them either.
 */

/** Every failure/refusal shape an agent can hand back, including a target that talks. */
const EVERY_AGENT_RESULT: AgentResult[] = [
  { reached: false, reason: 'ECONNREFUSED 127.0.0.1:8300' },
  { reached: false, reason: 'ETIMEDOUT' },
  reached(202, { state: 'starting' }),
  reached(200, { state: 'stopped' }),
  reached(200, { state: 'paused', message: 'Already paused.' }),
  reached(200, { state: 'playing', message: 'Already playing.' }),
  reached(409, { state: 'running' }),
  reached(409, { state: 'starting' }),
  reached(409, { state: 'stopped' }),
  reached(400, { state: 'error', message: 'seconds must be an integer' }),
  reached(404, { state: 'error' }),
  reached(500, { state: 'error', message: 'VLC web interface returned HTTP 401' }),
  reached(500, { state: 'error', message: 'spawn ENOENT C:\\steamcmd\\PalServer.exe' }),
  reached(418, { state: 'error', message: 'agent said something unexpected' }),
];

/** Every member-visible reply this code can produce, derived rather than listed. */
const everyReply = () => [
  ...EVERY_AGENT_RESULT.flatMap((c) => [
    describeStart(c),
    describeStop(c),
    describePause(c),
    describeResume(c),
    describeSeek(c, 30),
    describeSeek(c, -30),
    describeStep(c, 'next'),
    describeStep(c, 'previous'),
  ]),
  describeAddress({ ip: '203.0.113.7' }, 8211),
  describeAddress({ error: 'No IP-lookup service responded.' }, 8211),
];

test('007 T010 — no internal reaches a member, in ANY reply (FR-001, FR-002, SC-001)', () => {
  // The bans, as patterns rather than as a list of strings we happen to know about.
  const FORBIDDEN: [RegExp, string][] = [
    [/HTTP\s*\d{3}/i, 'an HTTP status code'],
    [/\b[45]\d{2}\b/, 'a bare status code'],
    [/\bE[A-Z]{4,}\b/, 'an errno'],
    [/\bagent\b/i, 'the agent — an internal component'],
    [/\bVLC\b/, 'the player product name'],
    [/\bseam\b|\bendpoint\b|\bpayload\b/i, 'seam vocabulary'],
    [/\b127\.0\.0\.1\b|\blocalhost\b/i, 'a loopback address'],
    [/:\d{4,5}\b/, 'a port'],
    [/\bexe\b|\.exe\b|[A-Z]:\\/i, 'a filesystem path or binary'],
  ];

  // `/address` is the one reply whose SUBSTANCE is an address and port — that is the
  // thing a member asked for and types into the game. FR-002 bans naming *our*
  // infrastructure's ports (the agent's, the admin API's), not the public connect port
  // this command exists to deliver. Exempted deliberately and narrowly: only the success
  // branch, and only the port pattern.
  const isConnectAddress = (r: { text: string }) => r.text === describeAddress({ ip: '203.0.113.7' }, 8211).text;
  for (const reply of everyReply()) {
    for (const [pattern, what] of FORBIDDEN) {
      if (what === 'a port' && isConnectAddress(reply)) continue;
      assert.doesNotMatch(
        said(reply),
        pattern,
        `a reply exposes ${what}: "${said(reply).trim()}"`,
      );
    }
  }

  // Command descriptions are read by members too, and are the other half of the surface.
  const descriptions = buildCommandGroups(TENANT_A)
    .flatMap((g) => g.commands)
    .flatMap((c) => toCommandEntries(c))
    .map((e) => e.description);
  for (const d of descriptions) {
    for (const [pattern, what] of FORBIDDEN) {
      assert.doesNotMatch(d, pattern, `a command description exposes ${what}: "${d}"`);
    }
  }
});

test('007 T011 — every failure keeps its detail for the operator (FR-006, SC-003)', () => {
  // A reply that hides a detail from the member must not lose it. The pairing is the
  // point: this is the half that makes T010 safe rather than merely quiet.
  for (const c of EVERY_AGENT_RESULT) {
    if (c.reached && c.status < 400) continue; // nothing went wrong; nothing to record
    for (const reply of [describeStart(c), describeStop(c), describePause(c), describeStep(c, 'next')]) {
      if (reply.tone !== 'failed') continue; // a refusal is an answer, not a fault
      assert.ok(
        logged(reply).trim().length > 0,
        `a failure told the member nothing and the operator nothing either: "${reply.text}"`,
      );
      if (c.reached && c.body.message !== undefined) {
        assert.ok(
          logged(reply).includes(c.body.message),
          "the target's own words must survive into the diagnostic, just not into the reply",
        );
      }
    }
  }
});

test('007 T038 — every failure leaves the reader something they can DO (SC-002)', () => {
  // T010 proves nothing leaks. On its own that is satisfiable by saying nothing useful.
  // This is the other half: the sentence a member is left with must be actionable.
  const ACTIONABLE = /\btry\b|\bask\b|\bcheck\b|\bwait\b|\bgive it\b|\bagain\b|\bstill running\b|\bnothing was\b|\bnothing to\b|\bpost again\b/i;

  for (const reply of everyReply()) {
    if (reply.tone === 'ok') continue; // success needs no remedy
    assert.match(
      said(reply),
      ACTIONABLE,
      `a member is told what went wrong but not what to do: "${said(reply).trim()}"`,
    );
  }
});

test('007 T032 — /help shows the new count with NO help text written for it (006 FR-008)', () => {
  // 006's whole point, re-proved by the first feature to change the surface since. The
  // count option was added in ONE place — `buildCommandGroups` — and the listing must
  // have picked it up as a derivation. If this needed a line of help text anywhere, the
  // second copy 006 deleted has grown back.
  const media: ControlledServer[] = [{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }];

  const registered = new Map(
    (buildCommands(media) as unknown as Cmd[]).map((c) => [c.name, c]),
  );
  const listed = new Map(
    buildCommandGroups(media)
      .flatMap((g) => g.commands)
      .flatMap((c) => toCommandEntries(c))
      .map((e) => [e.form.split(' ')[0]?.replace('/', ''), e]),
  );

  for (const name of ['next', 'previous']) {
    const entry = listed.get(name);
    assert.ok(entry, `/${name} must appear in the listing`);
    // Shown as OPTIONAL — square brackets, the same shape `[seconds]` already uses.
    assert.match(entry.form, /\[count\]/, `/${name} must show its optional count in the listing`);

    // And the description is the REGISTERED text, not a second copy authored for /help.
    const option = (registered.get(name)?.options ?? [])[0] as unknown as { description?: string };
    assert.ok(option?.description, `/${name} must register a described count option`);
    assert.ok(
      entry.description.includes(option.description),
      `/${name}'s listing text was authored separately instead of derived from the registration`,
    );
    // The default is visible to a reader, and stated once, in the registration.
    assert.match(entry.description, new RegExp(`default ${DEFAULT_STEP_COUNT}`, 'i'));
  }
});

/* ── 007 US2 — the detail is reported, never remembered ───────────────────────────── */

test('007 T022 — every availability combination renders, omitting only what is absent (SC-004, SC-005)', () => {
  const at = (b: Partial<AgentResponse>) => describePause(reached(200, { state: 'paused', ...b })).text;

  // Both halves present.
  assert.match(at({ title: 'Some Show', elapsedSeconds: 724, totalSeconds: 2671 }), /Some Show · 12:04 \/ 44:31/);
  // Title only — a player that reports no clock at all.
  assert.match(at({ title: 'Some Show' }), /Some Show/);
  assert.doesNotMatch(at({ title: 'Some Show' }), /\d+:\d\d/);
  // Position only — an untitled item.
  assert.match(at({ elapsedSeconds: 61, totalSeconds: 125 }), /1:01 \/ 2:05/);
  // A live stream: elapsed with NO total. "of 0:00" would be invented (SC-005).
  assert.match(at({ title: 'A stream', elapsedSeconds: 12 }), /A stream · 0:12/);
  assert.doesNotMatch(at({ title: 'A stream', elapsedSeconds: 12 }), /\//);
  // A total with no elapsed says nothing useful and is not rendered alone.
  assert.doesNotMatch(at({ totalSeconds: 2671 }), /44:31/);
  // Neither: the reply is the bare outcome, exactly as before 007.
  assert.equal(at({}), 'Paused.');

  // Past an hour the clock widens, and minutes pad — 1:05:03, never 1:5:3.
  assert.match(at({ elapsedSeconds: 3903, totalSeconds: 7200 }), /1:05:03 \/ 2:00:00/);

  // A placeholder must never stand in for something the player did not report.
  for (const text of [at({}), at({ title: 'x' }), at({ elapsedSeconds: 1 })]) {
    assert.doesNotMatch(text, /unknown|n\/a|untitled|null|undefined|NaN/i);
  }
});

test('007 T022 — a long name is shortened VISIBLY, never silently clipped (FR-009a, SC-017)', () => {
  // The filename fallback is where long names come from, and they land inline.
  const long = 'Some.Show.S02E07.Look.She.Made.A.Hat.1080p.AMZN.WEB-DL.x265.10bit.EAC3.5.1-Ghost.mkv';
  const text = describePause(reached(200, { state: 'paused', title: long })).text;

  assert.ok(text.length < long.length, 'the name was not shortened at all');
  assert.match(text, /…/, 'a shortened name must LOOK shortened — a silent clip reads as the whole name');
  assert.ok(text.startsWith('Paused. · Some.Show.'), 'the shortening must keep the front, which is the identifying part');

  // A name that fits is left exactly alone — no ellipsis, no truncation.
  const short = describePause(reached(200, { state: 'paused', title: 'Short Name' })).text;
  assert.doesNotMatch(short, /…/);
});

test('007 T021 — a game-only tenant renders EXACTLY as it did before this feature (SC-016)', () => {
  // The strongest regression check in 007: a media target must not change how a game
  // target reads. Game agents set none of the v5 fields, so the detail renders empty and
  // these lines are byte-identical to their pre-007 form.
  const games = describeStatus([
    { name: 'palworld', result: reached(200, { state: 'running' }) },
    { name: 'satisfactory', result: reached(200, { state: 'stopped' }) },
  ]);
  assert.doesNotMatch(games.text, /·/, 'a game line grew a detail separator it can never fill');
  assert.match(games.text, /\*\*Palworld\*\* — running/);
  assert.match(games.text, /\*\*Satisfactory\*\* — stopped/);

  // ONE LINE PER TARGET, detail inline — including when a media target is present (FR-008a).
  const mixed = describeStatus([
    { name: 'palworld', result: reached(200, { state: 'running' }) },
    { name: 'vlc', result: reached(200, { state: 'playing', title: 'Some Show', elapsedSeconds: 724, totalSeconds: 2671 }) },
  ]);
  const lines = mixed.text.split('\n').filter((l) => l.trim() !== '');
  assert.equal(lines.length, 2, 'the all-targets reply must stay one line per target');
  assert.match(lines[1] ?? '', /playing · Some Show · 12:04 \/ 44:31/);
  // And the game line is unchanged by its neighbour.
  assert.equal(lines[0], '**Palworld** — running');
});

test('007 T020 — nothing observed is REMEMBERED: every reply is a fresh reading (SC-006, FR-011)', () => {
  // A source scan cannot prove this — a cache is spelled with ordinary words. So drive a
  // sequence where the reported detail CHANGES between calls and assert each reply
  // reflects the CURRENT reading, with no trace of the previous one.
  const readings: AgentResponse[] = [
    { state: 'playing', title: 'First Item', elapsedSeconds: 10, totalSeconds: 100 },
    { state: 'playing', title: 'Second Item', elapsedSeconds: 5, totalSeconds: 200 },
    { state: 'playing', elapsedSeconds: 7 }, // the title DISAPPEARS — an untitled item
    { state: 'paused' }, // and now nothing is reported at all
  ];

  const texts = readings.map((body) => describeStep(reached(200, body), 'next', 1).text);

  assert.match(texts[0] ?? '', /First Item/);
  assert.match(texts[1] ?? '', /Second Item/);
  assert.doesNotMatch(texts[1] ?? '', /First Item/, 'a previous reading leaked into a later reply');
  // The hardest case: detail that VANISHES must vanish from the reply too. A cache would
  // helpfully keep showing the last title it saw — which is exactly the bug FR-011 forbids.
  assert.doesNotMatch(texts[2] ?? '', /First Item|Second Item/, 'a stale title survived a reading that had none');
  assert.match(texts[2] ?? '', /0:07/);
  assert.doesNotMatch(texts[3] ?? '', /Item|\d+:\d\d/, 'a reading with nothing to report must report nothing');
});

test('007 T039 — no command depends on another having run first (FR-013, SC-014)', () => {
  // Command independence, which is a different property from T020's statelessness: that
  // one says nothing is REMEMBERED, this says nothing is REQUIRED. Every reply must be a
  // pure function of the result handed to it, so running any command first changes
  // nothing about what another reports.
  const body: AgentResponse = { state: 'playing', title: 'Some Show', elapsedSeconds: 30, totalSeconds: 60 };
  const result = reached(200, body);

  const describers = [
    () => describePause(result).text,
    () => describeResume(result).text,
    () => describeSeek(result, 30).text,
    () => describeStep(result, 'next', 1).text,
    () => describeStatus([{ name: 'vlc', result }]).text,
  ];

  // Each in isolation…
  const alone = describers.map((d) => d());
  // …and each after every other has run. Identical, in every order.
  for (let i = 0; i < describers.length; i++) {
    for (const other of describers) other();
    assert.equal(describers[i]?.(), alone[i], 'a reply changed because another command ran first');
  }

  // FR-013's carve-out, asserted so a later reader does not "fix" it: a command's OWN
  // deferred continuation (the start follow-up) is not a cross-command dependency.
  assert.equal(describeStart(reached(202, { state: 'starting' })).tone, 'progress');
});

/* ── 007 Phase 7 convergence ───────────────────────────────────────────────────────── */

test('007 T040 — the follow-up and the no-media reply are IN the internals scan (SC-001)', () => {
  // Both are member-visible and both used to sit outside the scanned set: the follow-up
  // because it posts from followup.ts, and the no-media line because it was a bare literal
  // in the dispatch. Their wording happened to be clean, which is exactly why nothing
  // noticed they were never checked.
  const FORBIDDEN: [RegExp, string][] = [
    [/HTTP\s*\d{3}/i, 'a status code'],
    [/\b[45]\d{2}\b/, 'a bare status code'],
    [/\bE[A-Z]{4,}\b/, 'an errno'],
    [/\bagent\b/i, 'an internal component'],
    [/\bVLC\b/, 'the player product name'],
    [/:\d{4,5}\b/, 'a port'],
  ];

  const extras = [
    describeFollowup('palworld', true),
    describeFollowup('palworld', false),
    { tone: 'failed' as const, text: NO_MEDIA_TARGET },
  ];

  for (const reply of extras) {
    for (const [pattern, what] of FORBIDDEN) {
      assert.doesNotMatch(said(reply), pattern, `exposes ${what}: "${said(reply).trim()}"`);
    }
    assert.ok(said(reply).trim().length > 0);
  }

  // And each still leaves the reader something to do (SC-002).
  assert.match(said(extras[1]!), /\/status/, 'an unconfirmed start must point somewhere');
  assert.match(NO_MEDIA_TARGET, /ask/i, 'the no-media reply must offer a next step');
  // It must not state our configuration model, nor say "server" for a Discord guild —
  // "server" is the one noun this system cannot afford to overload (FR-002, FR-003).
  assert.doesNotMatch(NO_MEDIA_TARGET, /configur/i);
  assert.doesNotMatch(NO_MEDIA_TARGET, /\bserver\b/i);
});

test('007 T041 — sendReply does not call itself, and both send paths log (SC-003)', () => {
  // A REGRESSION FENCE for a real bug. A mechanical rewrite of the send sites matched
  // sendReply's own body and turned its `editReply` into a recursive `sendReply` call —
  // every Discord reply would have blown the stack. Nothing caught it: the unit tests
  // exercise the pure describe*/toEmbed functions, and the live check hit the agent
  // directly rather than the orchestrator's reply path.
  // Normalise line endings first: this repo checks out CRLF on Windows, and a `\n}\n`
  // sentinel silently matches nothing there — the slice then runs to end-of-file and
  // sweeps up every LEGITIMATE sendReply call site. A test that reports a bug in the wrong
  // place is worse than no test.
  const src = readFileSync(fileURLToPath(new URL('./commands.ts', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  const after = src.slice(src.indexOf('export async function sendReply'));
  const end = after.indexOf('\n}\n');
  assert.ok(end > 0, 'could not isolate sendReply — the fence would pass vacuously');
  const body = after.slice(0, end);

  assert.equal(
    /await sendReply\(/.test(body),
    false,
    'sendReply calls itself — infinite recursion on every reply',
  );
  assert.match(body, /interaction\.editReply/, 'sendReply must actually send');

  // The follow-up posts with followUp(), so it cannot reuse sendReply — it must still log.
  const followupSrc = readFileSync(fileURLToPath(new URL('./followup.ts', import.meta.url)), 'utf8');
  assert.match(followupSrc, /logDiagnostic\(/, 'the follow-up must record its operator half too');
});

// ── 008 T007: the extracted cores are what BOTH surfaces run ──────────────────
// The `run*` functions hold every decision a command makes — which verb is sent, which
// default is applied, how a sign is read. Discord and the local console both call them, so
// these tests are what make 008 SC-004 structural rather than aspirational: the two
// surfaces cannot answer the same command differently because there is only one answer.

/** An agent that records the verb it was asked for and answers with a canned result. */
function stubAgent(result: AgentResult): { agent: AgentClient; calls: string[] } {
  const calls: string[] = [];
  const record = (verb: string): Promise<AgentResult> => {
    calls.push(verb);
    return Promise.resolve(result);
  };
  const agent = {
    start: () => record('start'),
    stop: () => record('stop'),
    pause: () => record('pause'),
    play: () => record('play'),
    status: () => record('status'),
    seek: (s: number) => record(`seek:${s}`),
    next: (c: number) => record(`next:${c}`),
    previous: (c: number) => record(`previous:${c}`),
  } as unknown as AgentClient;
  return { agent, calls };
}

// ── `/stop` speaks twice, like `/start` ───────────────────────────────────────
// The agent now waits for the process to actually exit, so a stop takes seconds. The
// member is told what is happening, then told how it went.

/** Records what a command posted, in order: `editReply` first, then any `followUp`. */
function recordingInteraction(commandName: string): {
  interaction: never;
  posts: { via: 'editReply' | 'followUp'; text: string }[];
} {
  const posts: { via: 'editReply' | 'followUp'; text: string }[] = [];
  const grab = (via: 'editReply' | 'followUp') => async (payload: { embeds: { data: { description?: string } }[] }) => {
    posts.push({ via, text: payload.embeds[0]?.data.description ?? '' });
  };
  const interaction = {
    commandName,
    editReply: grab('editReply'),
    followUp: grab('followUp'),
  } as unknown as never;
  return { interaction, posts };
}

test('the first message states an INTENT and promises a second — it claims no outcome', () => {
  const first = describeStopping();
  assert.equal(first.tone, 'progress', 'amber like the start it mirrors, not a green result');
  assert.match(said(first), /sav(e|ing)/i, 'it should say what is being attempted');
  assert.match(said(first), /post again|confirm/i, 'it must promise the second message');
  // The save has NOT happened when this is posted. If it reads as a completed stop, the
  // failure branch that follows would contradict a claim already made.
  assert.doesNotMatch(first.text, /\bstopped\b|\bis down\b|\bexited\b/i);
});

test('/stop posts twice: what it is doing, then how it went', async () => {
  const { interaction, posts } = recordingInteraction('stop');
  const { agent } = stubAgent(reached(200, { state: 'stopped' }));

  await handleStop(interaction, new Map([['satisfactory', agent]]), 'satisfactory');

  assert.equal(posts.length, 2, 'a stop that reaches an agent must speak twice');
  assert.deepEqual(posts.map((p) => p.via), ['editReply', 'followUp'], 'first the ack, then a NEW message');
  assert.equal(posts[0]!.text, describeStopping().text);
  assert.equal(posts[1]!.text, describeStop(reached(200, { state: 'stopped' })).text);
});

test('an unknown server contacts nothing, so it must NOT announce a shutdown', async () => {
  const { interaction, posts } = recordingInteraction('stop');
  const { agent, calls } = stubAgent(reached(200, { state: 'stopped' }));

  await handleStop(interaction, new Map([['satisfactory', agent]]), 'nosuchgame');

  assert.equal(calls.length, 0, 'no agent may be contacted for a name that routes nowhere');
  assert.equal(posts.length, 1, 'narrating a shutdown that never starts would be a lie');
  assert.match(posts[0]!.text, /unknown server/i);
});

test('a stop that could not be confirmed down reads as progress, never as a failure', () => {
  const pending = describeStop(reached(202, { state: 'starting', message: 'World saved …' }));
  const failed = describeStop(reached(500, { state: 'error', message: 'save failed' }));
  const done = describeStop(reached(200, { state: 'stopped' }));

  assert.equal(pending.tone, 'progress', 'saved-and-shutting-down is not a failure');
  assert.notEqual(pending.tone, failed.tone, 'it must not look like the world may be at risk');
  assert.notEqual(said(pending), said(done), 'and it must not claim the server is down');

  // The distinction that matters: the 500 means STILL RUNNING with progress unsaved; the
  // 202 means saved and on its way down. Conflating them is the whole bug in reverse.
  assert.match(said(pending), /saved/i, 'it must say the world is safe');
  assert.match(said(failed), /still running/i, 'the failure must still say the server is up');
  assert.match(said(pending), /\/status/, 'it should leave the reader something to do (SC-002)');

  // The agent's own words are the OPERATOR's, never the member's (007 FR-005/FR-006).
  assert.doesNotMatch(said(pending), /202|World saved …/);
  assert.match(logged(pending), /202/);
});

test('a core returns EXACTLY what its describe function produces (FR-023 is inherited, not re-decided)', async () => {
  // The console shows `reply.text`; if a core reworded anything, the console could claim an
  // outcome the agent never reported. Identity here is what makes that impossible.
  const result = reached(202, { state: 'starting' });
  const { agent } = stubAgent(result);
  const agents = new Map([['palworld', agent]]);

  const start = await runStart(agents, 'palworld');
  assert.deepEqual(start.reply, describeStart(result), 'runStart must not reword describeStart');
  assert.equal(start.serverName, 'palworld', 'the core names the target it acted on');
  assert.equal(start.result, result, 'the raw result is carried so the follow-up can arm on a 202');

  const stop = await runStop(new Map([['palworld', stubAgent(result).agent]]), 'palworld');
  assert.deepEqual(stop.reply, describeStop(result), 'runStop must not reword describeStop');
});

test('the sign becomes a choice of VERB, and only a magnitude crosses the seam (005 FR-005)', async () => {
  const result = reached(200, { state: 'playing' });

  // `/next -3` steps BACK three, and the reply says so. The negative never reaches the agent.
  const back = stubAgent(result);
  const outNext = await runStep(new Map([['vlc', back.agent]]), 'vlc', 'next', -3);
  assert.deepEqual(back.calls, ['previous:3'], 'a negative count swaps the verb and sends a magnitude');
  assert.deepEqual(outNext.reply, describeStep(result, 'previous', 3));

  // `/previous -2` therefore steps FORWARD two — the same rule, mirrored.
  const fwd = stubAgent(result);
  await runStep(new Map([['vlc', fwd.agent]]), 'vlc', 'previous', -2);
  assert.deepEqual(fwd.calls, ['next:2'], 'the rule is symmetric, not special-cased for /next');

  // Zero has no direction to reverse, so it stays as asked.
  const zero = stubAgent(result);
  await runStep(new Map([['vlc', zero.agent]]), 'vlc', 'next', 0);
  assert.deepEqual(zero.calls, ['next:0'], 'zero is passed through, not reversed');

  // Omitted count is the documented default, applied in exactly one place.
  const dflt = stubAgent(result);
  await runStep(new Map([['vlc', dflt.agent]]), 'vlc', 'next');
  assert.deepEqual(dflt.calls, [`next:${DEFAULT_STEP_COUNT}`]);
});

test('seek passes its signed amount through exactly — no clamp, no magnitude conversion', async () => {
  const result = reached(200, { state: 'playing' });
  for (const seconds of [30, -30, 0, 99999, -1]) {
    const { agent, calls } = stubAgent(result);
    const out = await runSeek(new Map([['vlc', agent]]), 'vlc', seconds);
    assert.deepEqual(calls, [`seek:${seconds}`], `seek(${seconds}) must cross unchanged`);
    assert.deepEqual(out.reply, describeSeek(result, seconds));
  }
});

test('an unknown name contacts NOTHING and carries no result (FR-021, FR-030)', async () => {
  const { agent, calls } = stubAgent(reached(200, { state: 'running' }));
  const agents = new Map([['palworld', agent]]);

  for (const outcome of [
    await runStart(agents, 'nosuchgame'),
    await runStop(agents, 'nosuchgame'),
    await runPause(agents, 'nosuchgame'),
    await runResume(agents, 'nosuchgame'),
    await runSeek(agents, 'nosuchgame', 30),
    await runStep(agents, 'nosuchgame', 'next', 1),
  ]) {
    assert.equal(outcome.reply.tone, 'refused', 'an unknown name is refused, never routed');
    assert.match(outcome.reply.text, /palworld/, 'the refusal lists the valid names');
    assert.equal(outcome.result, undefined, 'nothing was launched, so nothing can arm a follow-up');
  }
  assert.deepEqual(calls, [], 'the configured agent must never be touched by a wrong name');

  // `/address` resolves against ports rather than agents, and must refuse the same way.
  const addr = await runAddress(new Map([['palworld', 8211]]), 'nosuchgame');
  assert.equal(addr.reply.tone, 'refused');
  assert.match(addr.reply.text, /palworld/);
});

test('status folds every target and names none of them', async () => {
  const up = stubAgent(reached(200, { state: 'running' }));
  const down = stubAgent(reached(200, { state: 'stopped' }));
  const out = await runStatus(new Map([['palworld', up.agent], ['satisfactory', down.agent]]));

  assert.deepEqual(up.calls, ['status'], 'status is a pure read');
  assert.deepEqual(down.calls, ['status']);
  assert.equal(out.serverName, undefined, 'a fold names no single target');
  assert.match(out.reply.text, /Palworld/);
  assert.match(out.reply.text, /Satisfactory/);
});

test('every media core sends its own verb and no other', async () => {
  const result = reached(200, { state: 'paused' });
  const cases: [string, (a: Map<string, AgentClient>) => Promise<unknown>][] = [
    ['pause', (a) => runPause(a, 'vlc')],
    ['play', (a) => runResume(a, 'vlc')],
  ];
  for (const [expected, run] of cases) {
    const { agent, calls } = stubAgent(result);
    await run(new Map([['vlc', agent]]));
    assert.deepEqual(calls, [expected], `expected exactly one ${expected}`);
  }
});
