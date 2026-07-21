import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The adapter is the one file that could ever kill the game server, so the ban is
// enforced against its source rather than trusted to review. These are contract
// obligations inherited by every future adapter, not stylistic preferences.
const source = readFileSync(fileURLToPath(new URL('./palworld.ts', import.meta.url)), 'utf8');

// Strip comments — they discuss the forbidden calls by name, deliberately.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
  .join('\n');

test('Palworld force-stop is never called (Constitution IV, DECISIONS 009)', () => {
  assert.doesNotMatch(
    code,
    /['"`][^'"`]*\/v1\/api\/stop/,
    'POST /v1/api/stop is Palworld\'s FORCE stop — it kills the process to satisfy the call',
  );
});

test('no OS-level process termination in the adapter (FR-006)', () => {
  for (const forbidden of [/\bprocess\.kill\b/, /\.kill\s*\(/, /\btaskkill\b/, /\bStop-Process\b/]) {
    assert.doesNotMatch(code, forbidden, `${forbidden} would force-terminate the game server`);
  }
});

test('stop saves BEFORE it shuts down, never after', () => {
  const save = code.indexOf('/v1/api/save');
  const shutdown = code.indexOf('/v1/api/shutdown');
  assert.ok(save > -1 && shutdown > -1, 'expected both calls to exist');
  assert.ok(save < shutdown, 'shutdown is issued before the save — SC-002 is zero-tolerance');
});

test('both process names are checked, so `starting` is distinguishable (DECISIONS 010)', () => {
  assert.match(code, /PalServer\.exe/, 'the launcher covers the window before the child appears');
  assert.match(
    code,
    /PalServer-Win64-Shipping-Cmd\.exe/,
    'the child covers the launcher exiting early',
  );
});

test('start passes the launch flags the adapter was observed against', () => {
  for (const flag of ['-useperfthreads', '-NoAsyncLoadingThread', '-UseMultithreadForDS']) {
    assert.match(code, new RegExp(flag), `missing launch flag ${flag}`);
  }
});
