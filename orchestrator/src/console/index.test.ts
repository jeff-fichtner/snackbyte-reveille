import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { EXIT, exitCodeFor, repoRootFrom } from './index.ts';
import type { CommandOutcome } from '../commands.ts';
import { describeStart, describeStop, describePause, describeStatus } from '../commands.ts';
import type { AgentResult } from '../agent-client.ts';
import type { AgentResponse } from '@reveille/contract';

const reached = (status: number, body: AgentResponse): AgentResult => ({ reached: true, status, body });
const unreachable: AgentResult = { reached: false, reason: 'ECONNREFUSED 127.0.0.1:8300' };

const outcome = (over: Partial<CommandOutcome>): CommandOutcome => ({
  reply: { tone: 'ok', text: 'fine' },
  serverName: undefined,
  result: undefined,
  statuses: undefined,
  ...over,
});

/** Every non-test module in the console, for the source-level guards. */
function consoleSources(): { file: string; code: string }[] {
  const dir = new URL('./', import.meta.url);
  return readdirSync(fileURLToPath(dir))
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((file) => ({
      file,
      code: readFileSync(fileURLToPath(new URL(file, dir)), 'utf8')
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, ''),
    }));
}

// ── T015: the four exit codes (FR-022) ────────────────────────────────────────

test('the four outcome classes map to their own codes', () => {
  assert.equal(exitCodeFor(outcome({ reply: describeStart(reached(202, { state: 'starting' })), result: reached(202, { state: 'starting' }) })), EXIT.OK);
  assert.equal(exitCodeFor(outcome({ reply: describeStop(reached(200, { state: 'stopped' })), result: reached(200, { state: 'stopped' }) })), EXIT.OK);
  assert.equal(exitCodeFor(outcome({ reply: describeStart(reached(409, { state: 'running' })), result: reached(409, { state: 'running' }) })), EXIT.REFUSED);
  assert.equal(exitCodeFor(outcome({ reply: describePause(unreachable), result: unreachable })), EXIT.UNREACHABLE);
});

test('REFUSED and UNREACHABLE never collapse — the retry rule depends on it', () => {
  const refused = exitCodeFor(outcome({ reply: describeStart(reached(409, { state: 'running' })), result: reached(409, { state: 'running' }) }));
  const gone = exitCodeFor(outcome({ reply: describePause(unreachable), result: unreachable }));

  assert.notEqual(refused, gone, 'a caller may retry an unreachable agent and must never retry a refusal');
  assert.equal(refused, 2);
  assert.equal(gone, 3);
});

test('`1` is never used, so a crash cannot be read as an outcome', () => {
  const codes = Object.values(EXIT);
  assert.equal(codes.includes(1 as never), false, 'Node exits 1 on an unhandled throw');
  assert.deepEqual([...codes].sort((a, b) => a - b), [0, 2, 3, 64]);
});

test('a status fold succeeds even when a target is unreachable — the READ worked', () => {
  const statuses = [
    { name: 'palworld', result: reached(200, { state: 'running' }) },
    { name: 'vlc', result: unreachable },
  ];
  assert.equal(exitCodeFor(outcome({ reply: describeStatus(statuses), statuses })), EXIT.OK);
});

test('the usage code is EX_USAGE, distinct from any outcome the system reported', () => {
  assert.equal(EXIT.USAGE, 64);
  assert.notEqual(EXIT.USAGE, EXIT.REFUSED);
  assert.notEqual(EXIT.USAGE, EXIT.UNREACHABLE);
});

// ── T022: the orchestrator is never in the path (FR-008, FR-009, SC-005) ──────

test('no console module contacts or starts the orchestrator to run a target command', () => {
  for (const { file, code } of consoleSources()) {
    // The console imports from the orchestrator's modules — that is deliberate reuse of the
    // reply functions. What it must never do is talk to the orchestrator PROCESS.
    assert.equal(
      /discord\.js/.test(code),
      false,
      `${file} must not touch the gateway — the console is not a second bot`,
    );
    // Anchored on `new`, because `AgentClient(` legitimately contains `Client(` — the
    // console's whole job is constructing those.
    assert.equal(
      /new\s+Client\(|new\s+REST\(|\.login\(/.test(code),
      false,
      `${file} must not open a Discord connection`,
    );
  }

  // `index.ts` is where a "just ask the orchestrator" shortcut would appear.
  const entry = consoleSources().find((s) => s.file === 'index.ts');
  assert.ok(entry !== undefined);
  assert.equal(
    /fetch\((?!`http:\/\/127\.0\.0\.1)/.test(entry.code),
    false,
    'every outbound call is to a loopback agent, never to an orchestrator endpoint',
  );
});

// ── T023 / T048: the console must never outlive the human (FR-016, FR-017, FR-020) ──

test('nothing is persisted between invocations — no state file, cache, or memo (FR-016)', () => {
  for (const { file, code } of consoleSources()) {
    if (file === 'logs.ts' || file === 'plane.ts') continue; // these legitimately write logs
    assert.equal(
      /writeFileSync|appendFileSync|createWriteStream/.test(code),
      false,
      `${file} writes to disk — the console keeps nothing between runs`,
    );
  }

  // Even the log modules must not be reading state back to make decisions, beyond the one
  // bounded live read the readiness probe needs.
  const logs = consoleSources().find((s) => s.file === 'logs.ts');
  assert.ok(logs !== undefined);
  assert.equal(/JSON\.parse/.test(logs.code), false, 'a log is output for a human, not a store');
});

test('nothing is scheduled, daemonised, or polled on the console’s own schedule (FR-020)', () => {
  for (const { file, code } of consoleSources()) {
    assert.equal(/setInterval\s*\(/.test(code), false, `${file} must not run on a schedule of its own`);
    assert.equal(/\.unref\(\)\s*;?\s*$/m.test(code) && file !== 'plane.ts', false, `${file}: only the launcher detaches`);
    assert.equal(/cron|schedule|daemon/i.test(code.replace(/scheduled/gi, '')), false, `${file} must not schedule work`);
    assert.equal(/--watch|watchMode/.test(code), false, `${file} must offer no always-on mode`);
  }
});

test('only the launcher detaches, and only for the components it starts (FR-017)', () => {
  const detaching = consoleSources().filter((s) => /detached:\s*true/.test(s.code));
  assert.deepEqual(
    detaching.map((s) => s.file),
    ['plane.ts'],
    'a detached child anywhere else would be a watcher outliving its human',
  );

  // And what it detaches is a plane SERVICE — an existing component — never a watcher.
  const plane = detaching[0];
  assert.ok(plane !== undefined);
  assert.match(plane.code, /entryScript/, 'what is spawned is a service, identified by its entry script');
});

test('the foreground watch is bounded and always terminates (FR-018)', () => {
  const entry = consoleSources().find((s) => s.file === 'index.ts');
  assert.ok(entry !== undefined);
  assert.match(entry.code, /deadline/, 'the watch has a deadline');
  assert.match(entry.code, /watchMs/, 'taken from the orchestrator’s existing follow-up bound');
  assert.equal(
    /while\s*\(\s*true\s*\)/.test(entry.code),
    false,
    'an unbounded loop would never produce an exit code',
  );
});

test('interrupting the watch is handled, and says the launch was not cancelled (FR-019)', () => {
  const src = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');
  assert.match(src, /SIGINT/, 'the interrupt is observed rather than ignored');
  assert.match(src, /unaffected/i, 'and the operator is told the launch still stands');
});

// ── T047: `status` and `plane status` must not be confusable (FR-024) ─────────

test('the plane report names its object, so a service being up cannot read as a target being up', () => {
  const src = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8');

  // The heading is the guard. The confusing case is agent up / game stopped, and the two
  // outputs must be self-describing enough that they can sit side by side.
  assert.match(src, /Reveille processes \(not the game servers or the player\)/,
    'the plane report must say whose processes it is describing');

  // And it must not borrow the target vocabulary that `/status` uses for games.
  const heading = /Reveille processes[^`]*?plane \$\{verb\}/.exec(src)?.[0] ?? '';
  assert.equal(/\brunning\b|\bstopped\b/.test(heading), false,
    'the plane heading must not use the words a game state uses');
});

test('a plane service label is never a target name, so the two lists cannot be conflated', () => {
  // Services are `<target>-agent` and `orchestrator`; targets are `palworld`, `vlc`, …
  const src = readFileSync(fileURLToPath(new URL('./plane.ts', import.meta.url)), 'utf8');
  assert.match(src, /\$\{target\}-agent/, 'an agent service is named after its target, but is not it');
});

// ── Misc structural guarantees ───────────────────────────────────────────────

test('the repo root is a fixed offset from this module — no parent-walking, no marker file', () => {
  const root = repoRootFrom(import.meta.url);
  // Round-tripped rather than matched by name: the property under test is the *offset*, and
  // asserting the directory's name only ever passed because this checkout happened to carry it —
  // it would fail on any clone into a differently-named folder, and did on the rename.
  assert.equal(
    resolve(root, 'orchestrator', 'src', 'console'),
    dirname(fileURLToPath(import.meta.url)),
    'three levels up from src/console',
  );
});

test('the console never touches the bot credentials it happens to have in scope', () => {
  for (const { file, code } of consoleSources()) {
    assert.equal(
      /DISCORD_BOT_TOKEN|DISCORD_APPLICATION_ID/.test(code),
      false,
      `${file}: the console has no use for the credential, and the repository is public`,
    );
  }
});

// ── T038: FR-025 must distinguish the two failure shapes ─────────────────────

import { buildAgentNotes } from './index.ts';
import type { ConsoleTarget } from './targets.ts';
import type { PlaneService } from './plane.ts';

const vlcTarget: ConsoleTarget = {
  name: 'vlc',
  baseUrl: 'http://127.0.0.1:8302',
  kind: 'media',
  publicPort: undefined,
};
const vlcService: PlaneService = {
  label: 'vlc-agent',
  envFile: 'agent/.env.vlc',
  entryScript: 'agent/src/index.ts',
  port: 8302,
};

test('an unreachable target says whether its AGENT is running — both halves (FR-025, SC-009)', () => {
  const targets = new Map([['vlc', vlcTarget]]);
  const statuses = [{ name: 'vlc', result: unreachable }];

  // Half one: the agent is up, so the PLAYER is what is not answering.
  const playerClosed = buildAgentNotes(statuses, targets, [vlcService], new Map([['vlc-agent', [{}]]]));
  assert.equal(playerClosed.length, 1);
  assert.match(playerClosed[0] ?? '', /IS running/, 'the agent is up');
  assert.match(playerClosed[0] ?? '', /target itself is not answering/, 'so the player is the problem');

  // Half two: the agent is down, and the fix is named.
  const agentDown = buildAgentNotes(statuses, targets, [vlcService], new Map([['vlc-agent', []]]));
  assert.match(agentDown[0] ?? '', /is NOT running/, 'the agent is down');
  assert.match(agentDown[0] ?? '', /reveille plane up vlc-agent/, 'and the operator is told what to run');

  // The two must be genuinely different sentences — that is the whole requirement.
  assert.notEqual(playerClosed[0], agentDown[0]);
});

test('a REACHABLE target gets no note — the divergence from Discord is failure-only', () => {
  const notes = buildAgentNotes(
    [{ name: 'vlc', result: reached(200, { state: 'playing' }) }],
    new Map([['vlc', vlcTarget]]),
    [vlcService],
    new Map([['vlc-agent', [{}]]]),
  );
  assert.deepEqual(notes, [], 'a healthy status line reads exactly as Discord reports it');
});

test('a target with no agent process on this host says so rather than guessing', () => {
  const offBox: ConsoleTarget = { ...vlcTarget, baseUrl: 'http://10.0.0.9:8302' };
  const notes = buildAgentNotes(
    [{ name: 'vlc', result: unreachable }],
    new Map([['vlc', offBox]]),
    [],
    new Map(),
  );
  assert.match(notes[0] ?? '', /no agent process is configured on this host/);
});

test('no silent default stands in for a missing public port (fail-loud, not `?? 0`)', () => {
  // Caught in review: `publicPort: t.publicPort ?? 0` would answer `address` with `…:0`
  // rather than failing — a connect string nobody can use, discovered later and indirectly.
  // `parseTenants` already rejects that shape, so the guard is unreachable; that is exactly
  // why it must throw rather than substitute a number.
  const entry = consoleSources().find((s) => s.file === 'index.ts');
  assert.ok(entry !== undefined);

  assert.equal(
    /publicPort:\s*[a-zA-Z.]*\s*\?\?/.test(entry.code),
    false,
    'a public port must never fall back to a default value',
  );
  assert.match(entry.code, /has no public port/, 'the missing case throws, naming the target');
});

test('every console module fails loud on missing configuration rather than substituting', () => {
  // The repo-wide rule: a missing required value must be a startup error naming itself, not
  // a default that produces wrong behaviour somewhere else later.
  for (const { file, code } of consoleSources()) {
    // `?? []` / `?? ''` on collections are defensive empties, not configuration defaults —
    // they cannot make the console act on the wrong thing. A numeric or URL default can.
    const suspicious = code.match(/\?\?\s*(\d+|['"`]https?:)/g) ?? [];
    assert.deepEqual(suspicious, [], `${file} has a numeric/address fallback: ${suspicious.join(', ')}`);
  }
});
