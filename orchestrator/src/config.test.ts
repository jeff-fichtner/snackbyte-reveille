import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, parseTenants, parseServers, required, requiredPositiveInt } from './config.ts';

// Two tenants with a deliberate mix: palworld exclusive to A, satisfactory exclusive to
// B, and vlc SHARED (the same agent url listed under both) — the canonical dev/prod split.
const TENANTS = JSON.stringify([
  {
    guildId: 'guild-a',
    name: 'playboy lounge',
    agents: [
      { name: 'palworld', url: 'http://127.0.0.1:8300', kind: 'game', publicPort: 8211 },
      { name: 'vlc', url: 'http://127.0.0.1:8302', kind: 'media' },
    ],
  },
  {
    guildId: 'guild-b',
    name: 'snackbyte dev',
    agents: [
      { name: 'satisfactory', url: 'http://127.0.0.1:8301', kind: 'game', publicPort: 7777 },
      { name: 'vlc', url: 'http://127.0.0.1:8302', kind: 'media' },
    ],
  },
]);

const complete = {
  DISCORD_BOT_TOKEN: 'tok',
  DISCORD_APPLICATION_ID: 'app',
  TENANTS,
  FOLLOWUP_TIMEOUT_MS: '120000',
} satisfies NodeJS.ProcessEnv;

test('a complete environment loads every tenant, each with its own scoped targets', () => {
  const config = loadConfig({ ...complete });
  assert.equal(config.tenants.size, 2);
  const a = config.tenants.get('guild-a');
  const b = config.tenants.get('guild-b');
  assert.ok(a && b, 'both tenants loaded');
  assert.deepEqual(a.servers.map((s) => s.name), ['palworld', 'vlc']);
  assert.deepEqual(b.servers.map((s) => s.name), ['satisfactory', 'vlc']);
  assert.equal(a.name, 'playboy lounge');
  assert.equal(config.followupTimeoutMs, 120000);
});

test('the config is isolated: one tenant’s targets are not the other’s (US1, FR-002)', () => {
  const config = loadConfig({ ...complete });
  const a = config.tenants.get('guild-a')!;
  const b = config.tenants.get('guild-b')!;
  assert.ok(a.servers.some((s) => s.name === 'palworld') && !b.servers.some((s) => s.name === 'palworld'));
  assert.ok(b.servers.some((s) => s.name === 'satisfactory') && !a.servers.some((s) => s.name === 'satisfactory'));
});

test('a target may be SHARED across tenants (same url under both) — FR-014', () => {
  const config = loadConfig({ ...complete });
  const aVlc = config.tenants.get('guild-a')!.servers.find((s) => s.name === 'vlc')!;
  const bVlc = config.tenants.get('guild-b')!.servers.find((s) => s.name === 'vlc')!;
  assert.equal(aVlc.baseUrl, bVlc.baseUrl, 'the same agent is deliberately listed under both tenants');
});

test('a name may repeat ACROSS tenants for different agents (names are per-tenant)', () => {
  const tenants = parseTenants({
    ...complete,
    TENANTS: JSON.stringify([
      { guildId: 'g1', agents: [{ name: 'box', url: 'http://127.0.0.1:9001', kind: 'media' }] },
      { guildId: 'g2', agents: [{ name: 'box', url: 'http://127.0.0.1:9002', kind: 'media' }] },
    ]),
  });
  assert.equal(tenants.get('g1')!.servers[0]!.baseUrl, 'http://127.0.0.1:9001');
  assert.equal(tenants.get('g2')!.servers[0]!.baseUrl, 'http://127.0.0.1:9002');
});

test('every required variable fails loudly by name when missing', () => {
  for (const key of Object.keys(complete)) {
    const env = { ...complete };
    delete env[key as keyof typeof complete];
    assert.throws(() => loadConfig(env), new RegExp(key), `${key} was allowed to be missing`);
  }
});

test('the 003 stopgap shape is REJECTED loudly, not reinterpreted (FR-011)', () => {
  // AGENTS or a routing DISCORD_GUILD_ID present → a migration error, even alongside TENANTS.
  assert.throws(() => parseTenants({ ...complete, AGENTS: '[]' }), /TENANTS/);
  assert.throws(() => parseTenants({ ...complete, DISCORD_GUILD_ID: 'g' }), /TENANTS/);
});

test('TENANTS must be present, non-blank, and a non-empty JSON array', () => {
  assert.throws(() => parseTenants({ ...complete, TENANTS: '' }), /TENANTS/);
  assert.throws(() => parseTenants({ ...complete, TENANTS: '   ' }), /TENANTS/);
  assert.throws(() => parseTenants({ ...complete, TENANTS: 'not json' }), /TENANTS/);
  assert.throws(() => parseTenants({ ...complete, TENANTS: '[]' }), /TENANTS/);
  assert.throws(() => parseTenants({ ...complete, TENANTS: '{"guildId":"g"}' }), /TENANTS/);
});

test('a malformed tenant fails loud, naming the offending field', () => {
  const bad = (tenants: unknown) => () => parseTenants({ ...complete, TENANTS: JSON.stringify(tenants) });
  assert.throws(bad([{ agents: [{ name: 'x', url: 'http://x', kind: 'media' }] }]), /guildId/, 'missing guildId');
  assert.throws(bad([{ guildId: '', agents: [{ name: 'x', url: 'http://x', kind: 'media' }] }]), /guildId/, 'blank guildId');
  assert.throws(
    bad([
      { guildId: 'dup', agents: [{ name: 'x', url: 'http://x', kind: 'media' }] },
      { guildId: 'dup', agents: [{ name: 'y', url: 'http://y', kind: 'media' }] },
    ]),
    /duplicate/i,
    'duplicate guildId',
  );
  assert.throws(bad([{ guildId: 'g', agents: [] }]), /agents/, 'empty agents');
  assert.throws(bad([{ guildId: 'g' }]), /agents/, 'missing agents');
});

test('a malformed target within a tenant fails loud (the 003 rules, now nested)', () => {
  const bad = (agents: unknown) => () => parseServers(agents, 'TENANTS[0]');
  assert.throws(bad([{ name: 'Bad Name', url: 'http://x', kind: 'game', publicPort: 1 }]), /name/);
  assert.throws(bad([{ name: 'ok', url: '', kind: 'game', publicPort: 1 }]), /url/);
  assert.throws(bad([{ name: 'ok', url: 'http://x' }]), /kind/);
  assert.throws(bad([{ name: 'ok', url: 'http://x', kind: 'game', publicPort: 0 }]), /publicPort/);
  assert.throws(bad([{ name: 'ok', url: 'http://x', kind: 'game' }]), /publicPort/, 'game missing port');
  assert.throws(bad([{ name: 'ok', url: 'http://x', kind: 'media', publicPort: 5 }]), /publicPort/, 'media must not have a port');
  assert.throws(
    bad([
      { name: 'dup', url: 'http://a', kind: 'media' },
      { name: 'dup', url: 'http://b', kind: 'media' },
    ]),
    /duplicate/i,
    'a name duplicated WITHIN one tenant',
  );
});

test('a tenant with more than one media target fails loud (/pause·/play are bare)', () => {
  assert.throws(
    () =>
      parseServers(
        [
          { name: 'vlc1', url: 'http://127.0.0.1:8080', kind: 'media' },
          { name: 'vlc2', url: 'http://127.0.0.1:8081', kind: 'media' },
        ],
        'TENANTS[0]',
      ),
    /more than one media|at most one/i,
  );
});

test('address is opaque — a non-loopback URL is accepted (FR-009 readiness)', () => {
  // The tenancy model must not assume loopback; a future off-box target is a different
  // url (plus a separate spec's auth), not a config-model change.
  const servers = parseServers([{ name: 'remote', url: 'https://her-box.example:8302', kind: 'media' }], 'T');
  assert.equal(servers[0]!.baseUrl, 'https://her-box.example:8302');
});

test('adding or removing a tenant is config-only; other tenants are unchanged (US2, SC-002)', () => {
  const two = loadConfig({ ...complete });
  const three = loadConfig({
    ...complete,
    TENANTS: JSON.stringify([
      ...(JSON.parse(TENANTS) as unknown[]),
      { guildId: 'guild-c', agents: [{ name: 'minecraft', url: 'http://127.0.0.1:8303', kind: 'game', publicPort: 25565 }] },
    ]),
  });
  assert.equal(three.tenants.size, 3);
  assert.ok(three.tenants.has('guild-c'), 'the new tenant appears');
  assert.deepEqual(
    three.tenants.get('guild-a')!.servers,
    two.tenants.get('guild-a')!.servers,
    'adding a tenant must not change another tenant',
  );
});

test('required/requiredPositiveInt name the variable in the error', () => {
  assert.throws(() => required('NOPE', {}), /NOPE/);
  assert.throws(() => requiredPositiveInt('ALSO_NOPE', { ALSO_NOPE: 'x' }), /ALSO_NOPE/);
});
