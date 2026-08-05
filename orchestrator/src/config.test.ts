import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, parseAgents, required, requiredPositiveInt } from './config.ts';

const AGENTS = JSON.stringify([
  { name: 'palworld', url: 'http://127.0.0.1:8300', kind: 'game', publicPort: 8211 },
  { name: 'satisfactory', url: 'http://127.0.0.1:8301', kind: 'game', publicPort: 7777 },
  { name: 'vlc', url: 'http://127.0.0.1:8302', kind: 'media' },
]);

const complete = {
  DISCORD_BOT_TOKEN: 'tok',
  DISCORD_APPLICATION_ID: 'app',
  DISCORD_GUILD_ID: 'guild',
  AGENTS,
  FOLLOWUP_TIMEOUT_MS: '120000',
} satisfies NodeJS.ProcessEnv;

test('a complete environment loads every configured target, of either kind', () => {
  const config = loadConfig({ ...complete });
  assert.equal(config.servers.length, 3);
  assert.deepEqual(
    config.servers.map((s) => s.name),
    ['palworld', 'satisfactory', 'vlc'],
  );
  const sat = config.servers.find((s) => s.name === 'satisfactory');
  assert.ok(sat, 'satisfactory not loaded');
  assert.equal(sat.baseUrl, 'http://127.0.0.1:8301');
  assert.equal(sat.kind, 'game');
  if (sat.kind === 'game') assert.equal(sat.publicPort, 7777);

  const vlc = config.servers.find((s) => s.name === 'vlc');
  assert.ok(vlc, 'vlc not loaded');
  assert.equal(vlc.kind, 'media');
  assert.equal(config.followupTimeoutMs, 120000);
});

test('the follow-up bound must be a positive integer (FR-029)', () => {
  for (const bad of ['0', '-1', 'soon', '1.5', '']) {
    assert.throws(
      () => loadConfig({ ...complete, FOLLOWUP_TIMEOUT_MS: bad }),
      /FOLLOWUP_TIMEOUT_MS/,
      `accepted ${JSON.stringify(bad)}`,
    );
  }
});

test('every required variable fails loudly by name when missing', () => {
  for (const key of Object.keys(complete)) {
    const env = { ...complete };
    delete env[key as keyof typeof complete];
    assert.throws(() => loadConfig(env), new RegExp(key), `${key} was allowed to be missing`);
  }
});

test('AGENTS must be present, non-blank, and a non-empty JSON array', () => {
  assert.throws(() => parseAgents({ ...complete, AGENTS: '' }), /AGENTS/);
  assert.throws(() => parseAgents({ ...complete, AGENTS: '   ' }), /AGENTS/);
  assert.throws(() => parseAgents({ ...complete, AGENTS: 'not json' }), /AGENTS/);
  assert.throws(() => parseAgents({ ...complete, AGENTS: '[]' }), /AGENTS/);
  assert.throws(() => parseAgents({ ...complete, AGENTS: '{"name":"x"}' }), /AGENTS/);
});

test('a malformed server entry fails loud, naming the offending field', () => {
  const bad = (agents: unknown) => () => parseAgents({ ...complete, AGENTS: JSON.stringify(agents) });
  assert.throws(bad([{ name: 'Bad Name', url: 'http://x', kind: 'game', publicPort: 1 }]), /name/, 'uppercase/space name');
  assert.throws(bad([{ name: 'ok', url: '', kind: 'game', publicPort: 1 }]), /url/, 'blank url');
  assert.throws(bad([{ name: 'ok', url: 'http://x' }]), /kind/, 'missing kind');
  assert.throws(bad([{ name: 'ok', url: 'http://x', kind: 'server' }]), /kind/, 'unknown kind');
  assert.throws(bad([{ name: 'ok', url: 'http://x', kind: 'game', publicPort: 0 }]), /publicPort/, 'zero game port');
  assert.throws(bad([{ name: 'ok', url: 'http://x', kind: 'game', publicPort: 1.5 }]), /publicPort/, 'non-integer game port');
  assert.throws(bad([{ name: 'ok', url: 'http://x', kind: 'game' }]), /publicPort/, 'game missing port');
  assert.throws(bad([{ name: 'ok', url: 'http://x', kind: 'media', publicPort: 5 }]), /publicPort/, 'media must not have a port');
  assert.throws(
    bad([
      { name: 'dup', url: 'http://a', kind: 'game', publicPort: 1 },
      { name: 'dup', url: 'http://b', kind: 'media' },
    ]),
    /duplicate/i,
    'duplicate names',
  );
});

test('a media entry loads with no public port; a game entry keeps one', () => {
  const servers = parseAgents({
    ...complete,
    AGENTS: JSON.stringify([
      { name: 'pal', url: 'http://127.0.0.1:8300', kind: 'game', publicPort: 8211 },
      { name: 'vlc', url: 'http://127.0.0.1:8302', kind: 'media' },
    ]),
  });
  const game = servers.find((s) => s.name === 'pal');
  const media = servers.find((s) => s.name === 'vlc');
  assert.ok(game && media);
  assert.equal(game.kind, 'game');
  assert.equal(media.kind, 'media');
  if (game.kind === 'game') assert.equal(game.publicPort, 8211);
});

test('a trailing slash on an agent URL is normalised away', () => {
  const servers = parseAgents({
    ...complete,
    AGENTS: JSON.stringify([{ name: 'p', url: 'http://127.0.0.1:8300//', kind: 'media' }]),
  });
  const first = servers.find((s) => s.name === 'p');
  assert.ok(first);
  assert.equal(first.baseUrl, 'http://127.0.0.1:8300');
});

test('required/requiredPositiveInt name the variable in the error', () => {
  assert.throws(() => required('NOPE', {}), /NOPE/);
  assert.throws(() => requiredPositiveInt('ALSO_NOPE', { ALSO_NOPE: 'x' }), /ALSO_NOPE/);
});
