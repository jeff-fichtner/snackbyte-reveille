import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Every adapter is the one file that could kill its game server, so the ban is
// enforced against source rather than trusted to review — the same contract
// obligations palworld.ts carries (Constitution IV, T011). These extend the
// palworld source tests to the second adapter (SC-009's guarantees apply to both).
const source = readFileSync(fileURLToPath(new URL('./satisfactory.ts', import.meta.url)), 'utf8');

// Strip comments — they discuss the forbidden calls and the client name by name.
const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('//'))
  .join('\n');

test('no OS-level process termination in the adapter (FR-006, Constitution IV)', () => {
  for (const forbidden of [/\bprocess\.kill\b/, /\.kill\s*\(/, /\btaskkill\b/, /\bStop-Process\b/]) {
    assert.doesNotMatch(code, forbidden, `${forbidden} would force-terminate the game server`);
  }
});

test('stop saves BEFORE it shuts down, never after (SC-002)', () => {
  const save = code.indexOf("'SaveGame'");
  const shutdown = code.indexOf("'Shutdown'");
  assert.ok(save > -1 && shutdown > -1, 'expected both API calls to exist');
  assert.ok(save < shutdown, 'Shutdown is issued before the save — SC-002 is zero-tolerance');
});

test('both process names are checked, so `starting` is distinguishable (DECISIONS 010)', () => {
  assert.match(code, /FactoryServer\.exe/, 'the launcher covers the window before the child appears');
  assert.match(
    code,
    /FactoryServer-Win64-Shipping\.exe/,
    'the child covers the launcher exiting early',
  );
});

test('the game CLIENT is never what counts as the server running (M0 gotcha)', () => {
  // FactoryGameSteam-Win64-Shipping.exe is the client and shares the Factory…
  // Win64-Shipping shape. Matching it would report a player's open game as "the
  // server is up". The adapter must anchor on FactoryServer, never FactoryGameSteam.
  assert.doesNotMatch(code, /FactoryGameSteam/, 'the adapter must not match the game client');
});
