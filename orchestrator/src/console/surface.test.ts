import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildConsoleCommands, parseArgv, mediaVerbNames, PLANE_VERBS } from './surface.ts';
import { buildCommandGroups, toCommandEntries, NO_MEDIA_TARGET } from '../commands.ts';
import type { ControlledServer } from '../config.ts';

const servers: ControlledServer[] = [
  { name: 'palworld', baseUrl: 'http://127.0.0.1:8300', kind: 'game', publicPort: 8211 },
  { name: 'satisfactory', baseUrl: 'http://127.0.0.1:8301', kind: 'game', publicPort: 7777 },
  { name: 'vlc', baseUrl: 'http://127.0.0.1:8302', kind: 'media' },
];
const gamesOnly = servers.filter((s) => s.kind === 'game');
const commands = buildConsoleCommands(servers);
const parse = (...argv: string[]) => parseArgv(argv, commands);

test('the console surface is EXACTLY the registered surface — no verb added or missing (FR-006)', () => {
  const registered = new Set(
    buildCommandGroups(servers).flatMap((g) => g.commands.map((c) => c.toJSON().name)),
  );
  assert.deepEqual(
    [...commands.keys()].sort(),
    [...registered].sort(),
    'a console verb that Discord lacks, or vice versa, is the drift 006 exists to prevent',
  );
});

test('a verb’s targets and argument are read off the registration, never authored (FR-005)', () => {
  assert.deepEqual(commands.get('start')?.targets, ['palworld', 'satisfactory']);
  assert.deepEqual(commands.get('pause')?.targets, [], 'media verbs are bare');
  assert.equal(commands.get('forward')?.option?.name, 'seconds');
  assert.equal(commands.get('next')?.option?.name, 'count');
  assert.equal(commands.get('pause')?.option, undefined);

  // Descriptions are copied verbatim from the same builders `/help` renders.
  const entries = buildCommandGroups(servers).flatMap((g) => g.commands.flatMap(toCommandEntries));
  const help = entries.find((e) => e.form === '/pause');
  assert.equal(commands.get('pause')?.description, help?.description);
});

test('adding a target to config adds it to the console with no code change (SC-004)', () => {
  const extended = buildConsoleCommands([
    ...servers,
    { name: 'valheim', baseUrl: 'http://127.0.0.1:8303', kind: 'game', publicPort: 2456 },
  ]);
  assert.ok(extended.get('start')?.targets.includes('valheim'));
  assert.equal(parseArgv(['start', 'valheim'], extended).kind, 'target');
});

test('a target verb with NO target fails and names both objects for the colliding pair (FR-003)', () => {
  for (const [verb, plane] of [['start', 'up'], ['stop', 'down']] as const) {
    const out = parse(verb);
    assert.equal(out.kind, 'usage', `bare \`${verb}\` must never guess`);
    if (out.kind !== 'usage') return;
    assert.match(out.message, /palworld/, 'it lists the targets it could have acted on');
    assert.match(
      out.message,
      new RegExp(`plane ${plane}`),
      'and names the control-plane verb, which is the other thing it could have meant',
    );
  }

  // `address` needs a target too, but collides with nothing — so it must NOT invent a
  // second meaning it does not have.
  const addr = parse('address');
  assert.equal(addr.kind, 'usage');
  if (addr.kind !== 'usage') return;
  assert.match(addr.message, /palworld/);
  assert.equal(/plane/.test(addr.message), false, 'there is no `plane address` to suggest');
});

test('a verb aimed at the WRONG KIND of target is refused, and contacts nothing', () => {
  const out = parse('start', 'vlc');
  assert.equal(out.kind, 'usage', '`start vlc` must not reach an agent');
  if (out.kind !== 'usage') return;
  assert.match(out.message, /palworld/, 'it lists what `start` can actually act on');
  assert.equal(/vlc/.test(out.message.replace(/`vlc`/, '')), false, 'vlc is not offered as valid');
});

test('an unknown target name lists the valid ones', () => {
  const out = parse('start', 'nosuchgame');
  assert.equal(out.kind, 'usage');
  if (out.kind !== 'usage') return;
  assert.match(out.message, /palworld/);
  assert.match(out.message, /satisfactory/);
});

test('a media verb with no media target is refused in the member’s own words', () => {
  const out = parseArgv(['pause'], buildConsoleCommands(gamesOnly));
  assert.equal(out.kind, 'usage');
  if (out.kind !== 'usage') return;
  assert.equal(out.message, NO_MEDIA_TARGET, 'the same sentence Discord gives — one wording, not two');
});

test('the media verb set is DERIVED, so a new media command needs no edit here', () => {
  const names = mediaVerbNames();
  for (const v of ['pause', 'play', 'next', 'previous', 'forward', 'back']) {
    assert.ok(names.has(v), `${v} must be recognised as a media verb`);
  }
  assert.equal(names.has('start'), false, 'a game verb is not a media verb');
  assert.equal(names.has('status'), false, '`status` belongs to no kind');

  // The guard that matters: no hand-written list of media verbs in the source.
  const src = readFileSync(fileURLToPath(new URL('./surface.ts', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(
    /['"]pause['"]\s*,\s*['"]play['"]/.test(code),
    false,
    'a literal media-verb list is the second copy this feature removes',
  );
});

test('bare verbs take one signed integer, and the sign survives parsing', () => {
  for (const [verb, raw, expected] of [
    ['forward', '90', 90],
    ['back', '-30', -30],
    ['next', '-3', -3],
    ['previous', '0', 0],
  ] as const) {
    const out = parse(verb, raw);
    assert.equal(out.kind, 'target');
    if (out.kind !== 'target') return;
    assert.equal(out.amount, expected, `${verb} ${raw} must pass through exactly`);
    assert.equal(out.targetName, undefined, 'a bare verb names no target');
  }

  // Omitted is not zero — it means "the default", applied downstream in one place.
  const bare = parse('forward');
  assert.equal(bare.kind, 'target');
  if (bare.kind !== 'target') return;
  assert.equal(bare.amount, undefined);
});

test('a non-integer argument is refused, quoting what the option actually means', () => {
  for (const bad of ['abc', '1.5', '', 'NaN']) {
    const out = parse('forward', bad);
    assert.equal(out.kind, 'usage', `\`forward ${bad}\` must not be run`);
  }
  const out = parse('forward', 'abc');
  if (out.kind !== 'usage') return;
  assert.match(out.message, /seconds/, 'it names the option');
  assert.match(out.message, /30/, 'and states the default, taken from the registered description');
});

test('an argument on a verb that takes none is refused', () => {
  const out = parse('pause', '30');
  assert.equal(out.kind, 'usage');
  const extra = parse('forward', '30', '60');
  assert.equal(extra.kind, 'usage', 'at most one argument');
});

test('no arguments and `help` are the same ask (FR-004)', () => {
  assert.equal(parse().kind, 'help');
  assert.equal(parse('help').kind, 'help');
});

test('the plane namespace parses its own verbs and an optional service', () => {
  for (const verb of PLANE_VERBS) {
    const out = parse('plane', verb);
    assert.equal(out.kind, 'plane');
    if (out.kind !== 'plane') return;
    assert.equal(out.verb, verb);
    assert.equal(out.service, undefined, 'omitting the service means all services');
  }

  const one = parse('plane', 'restart', 'orchestrator');
  assert.equal(one.kind, 'plane');
  if (one.kind !== 'plane') return;
  assert.equal(one.service, 'orchestrator');

  assert.equal(parse('plane').kind, 'usage', '`plane` alone names no verb');
  assert.equal(parse('plane', 'wat').kind, 'usage');
  assert.equal(parse('plane', 'up', 'a', 'b').kind, 'usage');
});

test('an unknown verb lists what is available, including `plane`', () => {
  const out = parse('frobnicate');
  assert.equal(out.kind, 'usage');
  if (out.kind !== 'usage') return;
  assert.match(out.message, /plane/, 'the plane namespace is part of what you can run');
  assert.match(out.message, /status/);
});

test('parsing contacts nothing — misuse never reaches an agent (SC-007)', () => {
  const src = readFileSync(fileURLToPath(new URL('./surface.ts', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/fetch\(/.test(code), false);
  assert.equal(/AgentClient/.test(code), false, 'deciding what was asked must not require asking anyone');
});
