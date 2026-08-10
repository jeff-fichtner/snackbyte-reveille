import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildTargetMap, resolveMediaTarget } from './targets.ts';

/** A `TENANTS` value, built the way a real `orchestrator/.env` holds it. */
const tenants = (...entries: unknown[]): NodeJS.ProcessEnv => ({
  TENANTS: JSON.stringify(entries),
});

const game = (name: string, url: string, publicPort = 8211) => ({
  name,
  url,
  kind: 'game',
  publicPort,
});
const media = (name: string, url: string) => ({ name, url, kind: 'media' });

test('every tenant’s targets are unioned — the console has no guild (FR-012)', () => {
  const map = buildTargetMap(
    tenants(
      { guildId: '1', name: 'house', agents: [game('palworld', 'http://127.0.0.1:8300')] },
      { guildId: '2', name: 'friends', agents: [game('satisfactory', 'http://127.0.0.1:8301', 7777)] },
    ),
  );

  assert.deepEqual([...map.keys()].sort(), ['palworld', 'satisfactory']);
  assert.equal(map.get('satisfactory')?.publicPort, 7777, 'a game carries its public port for `address`');
  assert.equal(map.get('palworld')?.kind, 'game');
});

test('a SHARED target — same name, same address — unions to exactly one entry (004 FR-014)', () => {
  const map = buildTargetMap(
    tenants(
      { guildId: '1', agents: [game('palworld', 'http://127.0.0.1:8300')] },
      { guildId: '2', agents: [game('palworld', 'http://127.0.0.1:8300')] },
    ),
  );

  assert.equal(map.size, 1, 'one target reachable by two guilds is still one target');
  assert.equal(map.get('palworld')?.baseUrl, 'http://127.0.0.1:8300');
});

test('same name, DIFFERENT address refuses and names BOTH tenants (FR-013)', () => {
  assert.throws(
    () =>
      buildTargetMap(
        tenants(
          { guildId: '111', name: 'house', agents: [game('palworld', 'http://127.0.0.1:8300')] },
          { guildId: '222', name: 'friends', agents: [game('palworld', 'http://10.0.0.5:8300')] },
        ),
      ),
    (error: Error) => {
      // Both sides, or the operator cannot act on it.
      assert.match(error.message, /house/, 'names the first tenant');
      assert.match(error.message, /friends/, 'names the second tenant');
      assert.match(error.message, /127\.0\.0\.1:8300/, 'names the first address');
      assert.match(error.message, /10\.0\.0\.5:8300/, 'names the second address');
      return true;
    },
    'picking either would silently command the wrong machine',
  );
});

test('a tenant with no friendly name is still identifiable in a conflict', () => {
  assert.throws(
    () =>
      buildTargetMap(
        tenants(
          { guildId: '111', agents: [game('palworld', 'http://a:8300')] },
          { guildId: '222', agents: [game('palworld', 'http://b:8300')] },
        ),
      ),
    /111[\s\S]*222|222[\s\S]*111/,
  );
});

test('missing or malformed configuration fails loud, naming the variable (FR-014)', () => {
  assert.throws(() => buildTargetMap({}), /TENANTS/, 'absent must name the variable');
  assert.throws(() => buildTargetMap({ TENANTS: '   ' }), /TENANTS/, 'blank must name the variable');
  assert.throws(() => buildTargetMap({ TENANTS: 'not json' }), /TENANTS/, 'unparseable must name it');
  assert.throws(() => buildTargetMap({ TENANTS: '[]' }), /TENANTS/, 'empty must name it');
  // The 004 migration guard still bites through this path.
  assert.throws(
    () => buildTargetMap({ AGENTS: '[]', TENANTS: '[]' }),
    /TENANTS/,
    'the legacy shape is rejected, not reinterpreted',
  );
});

test('there is NO fallback map and no built-in address — a missing config cannot yield a usable map', () => {
  // The failure mode this guards is the one the repo legislates against everywhere: a
  // console that "works" against a guessed 127.0.0.1:8300 would command a real machine.
  let built: unknown;
  try {
    built = buildTargetMap({});
  } catch {
    built = 'threw';
  }
  assert.equal(built, 'threw', 'no configuration must mean no map, never a default one');
});

test('the single media target is resolved for the bare verbs; two of them refuse', () => {
  const one = buildTargetMap(
    tenants({ guildId: '1', agents: [game('palworld', 'http://a:8300'), media('vlc', 'http://a:8302')] }),
  );
  assert.equal(resolveMediaTarget(one)?.name, 'vlc');
  assert.equal(resolveMediaTarget(one)?.publicPort, undefined, 'media forwards nothing');

  const none = buildTargetMap(tenants({ guildId: '1', agents: [game('palworld', 'http://a:8300')] }));
  assert.equal(resolveMediaTarget(none), undefined, 'no media target is not an error here');

  // Each tenant is legal alone; the UNION is what cannot be commanded by a bare verb.
  const two = buildTargetMap(
    tenants(
      { guildId: '1', agents: [media('vlc', 'http://a:8302')] },
      { guildId: '2', agents: [media('projector', 'http://b:8302')] },
    ),
  );
  assert.throws(
    () => resolveMediaTarget(two),
    /vlc[\s\S]*projector|projector[\s\S]*vlc/,
    'silently taking the first would be a wrong action, not a failed one',
  );
});

test('the target map is never derived from the agents’ own env files (FR-015)', () => {
  // A second, lossy copy of the map is the failure this forbids — those files carry neither
  // `kind` nor `publicPort`, so a map built from them must re-decide which verbs apply.
  const src = readFileSync(fileURLToPath(new URL('./targets.ts', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.equal(/\.env\./.test(code), false, 'targets.ts must not read an agent env file');
  assert.equal(/AGENT_PORT/.test(code), false, 'the agent port is not where a target address comes from');
  assert.equal(
    /readdir|readFile|existsSync/.test(code),
    false,
    'the target map comes from the environment, never from the filesystem',
  );
});

test('building the map contacts nothing — it is a pure read of configuration (FR-009)', () => {
  const src = readFileSync(fileURLToPath(new URL('./targets.ts', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  assert.equal(/fetch\(/.test(code), false, 'no network call may be needed to know what exists');
  assert.equal(/AgentClient/.test(code), false, 'knowing a target exists must not require reaching it');
});
