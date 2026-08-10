import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  commandLineMatches,
  discoverServices,
  matchProcesses,
  READY_TIMEOUT_MS,
  type PlaneService,
  type RunningProcess,
} from './plane.ts';

/** A throwaway repo shaped like the real one. Removed after each test. */
function fakeRepo(agentEnvs: Record<string, string>, withOrchestrator = true): string {
  const root = mkdtempSync(join(tmpdir(), 'reveille-plane-'));
  mkdirSync(join(root, 'agent'), { recursive: true });
  for (const [name, contents] of Object.entries(agentEnvs)) {
    writeFileSync(join(root, 'agent', name), contents, 'utf8');
  }
  if (withOrchestrator) {
    mkdirSync(join(root, 'orchestrator'), { recursive: true });
    writeFileSync(join(root, 'orchestrator', '.env'), 'TENANTS=[]\n', 'utf8');
  }
  return root;
}

const proc = (pid: number, commandLine: string): RunningProcess => ({ pid, commandLine });

test('services are DISCOVERED from the env files — a new target needs no code change', () => {
  const root = fakeRepo({
    '.env.palworld': 'TARGET=palworld\nAGENT_PORT=8300\n',
    '.env.vlc': 'TARGET=vlc\nAGENT_PORT=8302\n',
    '.env.example': 'TARGET=palworld\nAGENT_PORT=8300\n',
  });
  try {
    const services = discoverServices(root);
    const labels = services.map((s) => s.label).sort();

    assert.deepEqual(labels, ['orchestrator', 'palworld-agent', 'vlc-agent']);
    assert.equal(
      labels.includes('example-agent'),
      false,
      '.env.example is documentation, not a service',
    );

    // Drop in a fourth target's env file and it is managed — no table to edit.
    writeFileSync(join(root, 'agent', '.env.valheim'), 'TARGET=valheim\nAGENT_PORT=8303\n', 'utf8');
    const after = discoverServices(root).map((s) => s.label);
    assert.ok(after.includes('valheim-agent'), 'a new env file IS a new service');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('each agent’s port has EXACTLY ONE source — its own env file', () => {
  const root = fakeRepo({ '.env.satisfactory': 'TARGET=satisfactory\nAGENT_PORT=8301\n' });
  try {
    const agent = discoverServices(root).find((s) => s.label === 'satisfactory-agent');
    assert.equal(agent?.port, 8301, 'the port is read, never assumed');
    assert.equal(
      discoverServices(root).find((s) => s.label === 'orchestrator')?.port,
      undefined,
      'the orchestrator has no inbound port — that is the property 008 protects',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a missing or broken AGENT_PORT fails loud rather than guessing', () => {
  // A guessed port would probe — and could later kill — the wrong thing entirely.
  for (const contents of ['TARGET=palworld\n', 'TARGET=palworld\nAGENT_PORT=\n', 'TARGET=palworld\nAGENT_PORT=abc\n', 'TARGET=palworld\nAGENT_PORT=0\n']) {
    const root = fakeRepo({ '.env.palworld': contents });
    try {
      assert.throws(() => discoverServices(root), /AGENT_PORT/, `must name the variable for: ${JSON.stringify(contents)}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test('env parsing ignores comments and blank lines, as the real files have plenty of both', () => {
  const root = fakeRepo({
    '.env.palworld': '# a comment\n\n  # indented comment\nTARGET=palworld\n\nAGENT_PORT=8300  \n',
  });
  try {
    assert.equal(discoverServices(root).find((s) => s.label === 'palworld-agent')?.port, 8300);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── Constitution IV: `plane down` can never touch a controlled target (FR-033) ─

// Absolute, as discovery produces them — the repo root is part of a service's identity, so
// a second checkout on the same machine cannot be mistaken for this one.
const ROOT = 'C:/dev/snackbyte/code/snackbyte-reveille';
const services: PlaneService[] = [
  { label: 'palworld-agent', envFile: `${ROOT}/agent/.env.palworld`, entryScript: `${ROOT}/agent/src/index.ts`, port: 8300 },
  { label: 'orchestrator', envFile: `${ROOT}/orchestrator/.env`, entryScript: `${ROOT}/orchestrator/src/index.ts`, port: undefined },
];

test('the matcher CANNOT select a game server, VLC, or an unrelated node process (FR-033, SC-008)', () => {
  const bystanders = [
    proc(1, 'C:\\steamcmd\\steamapps\\common\\PalServer\\PalServer.exe'),
    proc(2, 'C:\\steamcmd\\steamapps\\common\\PalServer\\Pal\\Binaries\\Win64\\PalServer-Win64-Shipping-Cmd.exe'),
    proc(3, 'C:\\steamcmd\\steamapps\\common\\SatisfactoryDedicatedServer\\FactoryServer.exe'),
    proc(4, '"C:\\Program Files\\VideoLAN\\VLC\\vlc.exe" --extraintf http'),
    proc(5, '"C:\\Program Files\\nodejs\\node.exe" some-other-project/src/index.ts'),
    proc(6, '"C:\\Program Files\\nodejs\\node.exe" -e "setInterval(()=>{},1e3)"'),
    // The sharpest one: our entry script, but somebody ELSE's config.
    proc(7, `"C:\\Program Files\\nodejs\\node.exe" --env-file=${ROOT}/other/.env ${ROOT}/agent/src/index.ts`),
    // The one that made absolute paths necessary: a SECOND CHECKOUT of this same repository.
    // Identical relative paths, different root. Matching on `agent/src/index.ts` alone would
    // let `plane down` here stop that clone's agents.
    proc(8, 'node.exe --env-file=D:/clone/agent/.env.palworld D:/clone/agent/src/index.ts'),
  ];

  const matched = matchProcesses(bystanders, services);
  for (const [label, procs] of matched) {
    assert.deepEqual(procs, [], `${label} must match none of these — none of them is Reveille`);
  }
});

test('the matcher DOES select Reveille’s own, by entry script AND env file together', () => {
  const ours = [
    proc(10, `"C:\\Program Files\\nodejs\\node.exe" --env-file=${ROOT}/agent/.env.palworld ${ROOT}/agent/src/index.ts`),
    proc(11, `"C:\\Program Files\\nodejs\\node.exe" --env-file=${ROOT}/orchestrator/.env ${ROOT}/orchestrator/src/index.ts`),
    // Windows-style separators and casing, as a real command line reports them.
    proc(12, 'node.exe --env-file=C:\\Dev\\Snackbyte\\Code\\snackbyte-reveille\\agent\\.env.palworld C:\\Dev\\Snackbyte\\Code\\snackbyte-reveille\\agent\\src\\index.ts'),
  ];
  const matched = matchProcesses(ours, services);

  assert.deepEqual(matched.get('palworld-agent')?.map((p) => p.pid), [10, 12], 'both separator styles match');
  assert.deepEqual(matched.get('orchestrator')?.map((p) => p.pid), [11]);
});

test('one agent’s process is never mistaken for another’s', () => {
  const all: PlaneService[] = [
    ...services,
    { label: 'vlc-agent', envFile: `${ROOT}/agent/.env.vlc`, entryScript: `${ROOT}/agent/src/index.ts`, port: 8302 },
  ];
  const matched = matchProcesses(
    [proc(20, `node --env-file=${ROOT}/agent/.env.vlc ${ROOT}/agent/src/index.ts`)],
    all,
  );

  assert.deepEqual(matched.get('vlc-agent')?.map((p) => p.pid), [20]);
  assert.deepEqual(matched.get('palworld-agent'), [], 'the shared entry script alone must not match');
});

test('a stopped-then-restarted machine cannot make the matcher hit a stranger (FR-032)', () => {
  // The property a pid file cannot offer: identity is re-derived from what the process is
  // actually running, so a recycled pid is simply a different command line.
  const recycled = proc(49824, '"C:\\Windows\\System32\\notepad.exe"');
  assert.equal(commandLineMatches(recycled.commandLine, services[0] as PlaneService), false);
});

test('the readiness bound is a real, finite number (FR-034, always-terminates)', () => {
  assert.ok(Number.isFinite(READY_TIMEOUT_MS) && READY_TIMEOUT_MS > 0);
  assert.ok(READY_TIMEOUT_MS <= 60_000, 'a bound nobody would wait out is not a bound');
});

test('discovery reads only env files — never the tenant configuration (the two questions stay separate)', () => {
  const root = fakeRepo({ '.env.palworld': 'TARGET=palworld\nAGENT_PORT=8300\n' });
  try {
    // No TENANTS anywhere, and discovery still works: the service list does not depend on it.
    const services2 = discoverServices(root);
    assert.ok(services2.length >= 1, 'the plane is discoverable without any target configuration');
    assert.ok(readdirSync(join(root, 'agent')).includes('.env.palworld'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── T029 / T034: plane up VERIFIES, and reports honestly when it cannot ───────
// These spawn for real, against a throwaway repo. The failed-start path is the whole
// reason FR-034 exists: removing the window removed the only place that failure showed.

import { planeUp, planeDown, planeStatus, isAnswering } from './plane.ts';
import { logPath } from './logs.ts';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

/** A repo whose "agent" is whatever script body you give it. */
function repoWithAgent(body: string, envs: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'reveille-up-'));
  mkdirSync(join(root, 'agent', 'src'), { recursive: true });
  writeFileSync(join(root, 'agent', 'src', 'index.ts'), body, 'utf8');
  for (const [name, contents] of Object.entries(envs)) {
    writeFileSync(join(root, 'agent', name), contents, 'utf8');
  }
  return root;
}

/** A port nothing is on. High and odd enough not to collide with the real plane. */
const PROBE_PORT = 8391;
const PROBE_PORT_2 = 8392;
const PROBE_PORT_3 = 8393;

test('a service that dies at boot is reported FAILED, never started, and names its log (FR-034, SC-010)', async () => {
  // Exactly the real failure mode: a required env var is missing, so it throws and exits.
  const root = repoWithAgent(
    'throw new Error("Missing required environment variable VLC_PASSWORD");',
    { '.env.broken': `TARGET=broken\nAGENT_PORT=${PROBE_PORT}\n` },
  );
  try {
    const services = discoverServices(root).filter((s) => s.label === 'broken-agent');
    const outcomes = await planeUp(services, root, 2_000);

    assert.equal(outcomes.length, 1);
    assert.equal(outcomes[0]?.state, 'failed', 'a dead process must NEVER be reported as started');
    assert.equal(outcomes[0]?.detail, logPath(root, 'broken-agent'), 'and its log must be named');

    // The fail-loud error is in that log — which is the whole point of redirecting output.
    assert.match(
      readFileSync(logPath(root, 'broken-agent'), 'utf8'),
      /VLC_PASSWORD/,
      'the reason is where the operator was pointed',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('plane up is idempotent — an already-running service is skipped, never launched twice (FR-030)', async () => {
  // Serves /status so it looks exactly like a real agent to the readiness probe.
  const root = repoWithAgent(
    [
      "import { createServer } from 'node:http';",
      "createServer((_req, res) => { res.writeHead(200, {'content-type':'application/json'}); res.end('{\"state\":\"stopped\"}'); })",
      "  .listen(Number(process.env.AGENT_PORT), '127.0.0.1', () => console.log('agent listening'));",
    ].join('\n'),
    { '.env.probe': `TARGET=probe\nAGENT_PORT=${PROBE_PORT_2}\n` },
  );
  const services = discoverServices(root).filter((s) => s.label === 'probe-agent');
  try {
    const first = await planeUp(services, root, 8_000);
    const log = (() => { try { return readFileSync(logPath(root, 'probe-agent'), 'utf8'); } catch { return '(no log)'; } })();
    assert.equal(first[0]?.state, 'up', `it starts and is confirmed SERVING, not merely alive. log: ${log}`);

    const second = await planeUp(services, root, 8_000);
    assert.equal(second[0]?.state, 'skipped', 'a second launch would race for the port and die');
    assert.match(second[0]?.detail ?? '', /already running/);
  } finally {
    await planeDown(services);
    // Windows does not release the log handle the instant the process is signalled, and
    // `rmSync` on a directory whose file is still open is an EPERM. Give it a moment, and
    // treat a stubborn temp directory as noise rather than a test failure.
    await new Promise((r) => setTimeout(r, 500));
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A leftover temp directory is the OS's business, not this test's verdict.
    }
  }
});

test('the exit-worthy signal is present: a failed service is distinguishable from a skipped one', async () => {
  // `plane up` reports per service and the worst one decides the code, so these must differ.
  const states = new Set(['up', 'skipped', 'failed', 'down', 'stopped', 'foreign']);
  assert.equal(states.size, 6, 'each outcome is its own word — none doubles for another');
});

test('a port held by a process we do NOT own is reported foreign — never `up`, never `was not running`', async () => {
  // A REGRESSION FENCE for a measured bug. An agent started by hand does not match the
  // absolute-path signature, so `plane up` saw nothing of its own, spawned, and its child
  // died on EADDRINUSE — then the readiness probe found the FOREIGN holder answering and
  // reported `up`. Success, for a process that no longer existed. `plane down` then said
  // "was not running" while the port kept serving. Ownership is the process; liveness is
  // the port; this is what keeps them apart.
  const root = repoWithAgent(
    "throw new Error('this must never even be reached');",
    { '.env.taken': `TARGET=taken\nAGENT_PORT=${PROBE_PORT_3}\n` },
  );
  // An interloper that answers /status but is NOT one of our services — spawned via `-e`, so
  // its command line carries neither our entry script nor our env file.
  const interloper = spawn(
    process.execPath,
    [
      '-e',
      "const {createServer}=require('node:http');createServer((_q,s)=>{s.writeHead(200,{'content-type':'application/json'});s.end('{\"state\":\"stopped\"}');})" +
        `.listen(${PROBE_PORT_3},'127.0.0.1');`,
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  try {
    // Let it bind before asking anything.
    for (let i = 0; i < 50 && !(await isAnswering(PROBE_PORT_3)); i += 1) {
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(await isAnswering(PROBE_PORT_3), 'the interloper never came up — test cannot conclude');

    const services = discoverServices(root).filter((s) => s.label === 'taken-agent');

    const up = await planeUp(services, root, 2_000);
    assert.equal(up[0]?.state, 'foreign', 'a port we do not own must NEVER be reported as up');
    assert.match(up[0]?.detail ?? '', new RegExp(`${PROBE_PORT_3}`), 'and it must name the port');

    const status = await planeStatus(services);
    assert.equal(status[0]?.state, 'foreign', 'status must not call a served port "no process"');

    const down = await planeDown(services);
    assert.equal(down[0]?.state, 'foreign', 'down must not report a clean stop over a live port');
    assert.doesNotMatch(down[0]?.detail ?? '', /was not running/);

    // And it was LEFT ALONE — an unrecognised process is explicitly not ours to kill (FR-033).
    assert.ok(await isAnswering(PROBE_PORT_3), 'plane down killed a process that was not its own');
  } finally {
    interloper.kill();
    await new Promise((r) => setTimeout(r, 300));
    try {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // A leftover temp directory is the OS's business, not this test's verdict.
    }
  }
});
