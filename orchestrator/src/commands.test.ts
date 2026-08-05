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
  toEmbed,
  routeToAgent,
  buildCommands,
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
    ['address', 'back', 'forward', 'pause', 'play', 'start', 'status', 'stop'],
  );
  // The acting game verbs name palworld and nothing else — no other tenant's game leaks in.
  for (const verb of ['start', 'stop', 'address']) {
    const subs = (cmds.find((c) => c.name === verb)?.options ?? []).map((o) => o.name);
    assert.deepEqual(subs, ['palworld'], `/${verb} should offer only this tenant's game`);
  }
});

test('buildCommands: a media-only tenant gets the media verbs + status, no game verbs', () => {
  const cmds = buildCommands([{ name: 'vlc', baseUrl: 'http://x', kind: 'media' }]) as unknown as Cmd[];
  assert.deepEqual(cmds.map((c) => c.name).sort(), ['back', 'forward', 'pause', 'play', 'status']);
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
