import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, parseAgents, required, requiredPositiveInt } from './config.ts';

const AGENTS = JSON.stringify([
  { name: 'palworld', url: 'http://127.0.0.1:8300', publicPort: 8211 },
  { name: 'satisfactory', url: 'http://127.0.0.1:8301', publicPort: 7777 },
]);

const complete = {
  DISCORD_BOT_TOKEN: 'tok',
  DISCORD_APPLICATION_ID: 'app',
  DISCORD_GUILD_ID: 'guild',
  AGENTS,
} satisfies NodeJS.ProcessEnv;

test('a complete environment loads every configured server', () => {
  const config = loadConfig({ ...complete });
  assert.equal(config.servers.length, 2);
  assert.deepEqual(
    config.servers.map((s) => s.name),
    ['palworld', 'satisfactory'],
  );
  const sat = config.servers.find((s) => s.name === 'satisfactory');
  assert.ok(sat, 'satisfactory not loaded');
  assert.equal(sat.baseUrl, 'http://127.0.0.1:8301');
  assert.equal(sat.publicPort, 7777);
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
  assert.throws(bad([{ name: 'Bad Name', url: 'http://x', publicPort: 1 }]), /name/, 'uppercase/space name');
  assert.throws(bad([{ name: 'ok', url: '', publicPort: 1 }]), /url/, 'blank url');
  assert.throws(bad([{ name: 'ok', url: 'http://x', publicPort: 0 }]), /publicPort/, 'zero port');
  assert.throws(bad([{ name: 'ok', url: 'http://x', publicPort: 1.5 }]), /publicPort/, 'non-integer port');
  assert.throws(bad([{ name: 'ok', url: 'http://x' }]), /publicPort/, 'missing port');
  assert.throws(
    bad([
      { name: 'dup', url: 'http://a', publicPort: 1 },
      { name: 'dup', url: 'http://b', publicPort: 2 },
    ]),
    /duplicate/i,
    'duplicate names',
  );
});

test('a trailing slash on an agent URL is normalised away', () => {
  const servers = parseAgents({
    ...complete,
    AGENTS: JSON.stringify([{ name: 'p', url: 'http://127.0.0.1:8300//', publicPort: 8211 }]),
  });
  const first = servers.find((s) => s.name === 'p');
  assert.ok(first);
  assert.equal(first.baseUrl, 'http://127.0.0.1:8300');
});

test('required/requiredPositiveInt name the variable in the error', () => {
  assert.throws(() => required('NOPE', {}), /NOPE/);
  assert.throws(() => requiredPositiveInt('ALSO_NOPE', { ALSO_NOPE: 'x' }), /ALSO_NOPE/);
});
