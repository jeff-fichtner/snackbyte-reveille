/**
 * The control plane: Reveille's own long-lived processes (008 US2).
 *
 * **A different question from a target.** A *target* is a thing the system controls, and
 * `TENANTS` says which ones exist and where. A *service* is one of Reveille's own processes
 * on this box. The two are deliberately sourced differently, and conflating them is how the
 * old script ended up storing each agent's port a third time.
 *
 * | Question | Source |
 * |---|---|
 * | Which targets can I command, and at what address? | `TENANTS` (`targets.ts`) |
 * | Which processes make up the control plane here? | `agent/.env.*` + `orchestrator/.env` |
 *
 * `reveille.ps1` hardcoded a four-row table naming each service's env file, entry script and
 * port — and that port was already written in `agent/.env.<target>` as `AGENT_PORT` and again
 * inside the `TENANTS` URL. Three copies of one number, each able to drift. Services are
 * discovered here instead, so a fourth target is managed the moment its env file exists.
 */
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { logPath, logSize, openLog, rotate, waitForLogLine } from './logs.ts';

const execFileAsync = promisify(execFile);

/**
 * One long-lived Reveille process on this host.
 *
 * `envFile` and `entryScript` are **absolute**, and that is load-bearing rather than
 * incidental. Launching with relative paths puts only `agent/src/index.ts` on the command
 * line, which is identical in every checkout of this repository — so a second clone on the
 * same machine would match, and `plane down` in one would stop the other's agents. Absolute
 * paths carry the repository root, which makes the identity unambiguous.
 */
export interface PlaneService {
  readonly label: string;
  readonly envFile: string;
  readonly entryScript: string;
  /** Agents only. The orchestrator has no inbound port — that is the property 008 protects. */
  readonly port: number | undefined;
}

/**
 * How long a service gets to become ready before `plane up` calls it failed (FR-034).
 *
 * **Named explicitly because an unbounded wait would contradict the always-terminates rule**
 * (`contracts/console-surface.md` §6). Generous relative to what M0 measured — an agent was
 * serving in well under a second — because the cost of waiting slightly too long is a pause,
 * and the cost of giving up too early is calling a healthy service failed.
 *
 * This is not configuration: it bounds an internal wait that no operator needs to tune, and
 * an env var here would be a required value the fail-loud rule would then demand be set.
 */
export const READY_TIMEOUT_MS = 15_000;

/** The line the orchestrator writes once it is genuinely connected. Its readiness signal. */
const ORCHESTRATOR_READY = /orchestrator connected as /;

/** Read one `KEY=VALUE` out of an env file. No dependency, and no interpretation beyond that. */
function readEnvValue(path: string, key: string): string | undefined {
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    if (trimmed.slice(0, eq).trim() === key) return trimmed.slice(eq + 1).trim();
  }
  return undefined;
}

/**
 * Every service that makes up the control plane on this host.
 *
 * Derived from the filesystem: each `agent/.env.<target>` is one agent, and
 * `orchestrator/.env` is the orchestrator. No table to keep in step with reality.
 */
export function discoverServices(repoRoot: string): PlaneService[] {
  const services: PlaneService[] = [];
  const agentDir = join(repoRoot, 'agent');

  if (existsSync(agentDir)) {
    // `.env.example` is documentation, not a service. Everything else named `.env.<x>` is one.
    const envFiles = readdirSync(agentDir)
      .filter((f) => f.startsWith('.env.') && f !== '.env.example')
      .sort();

    for (const file of envFiles) {
      const target = file.slice('.env.'.length);
      const raw = readEnvValue(join(agentDir, file), 'AGENT_PORT');
      const port = raw === undefined ? Number.NaN : Number(raw);
      if (!Number.isInteger(port) || port <= 0) {
        // The port has exactly one source, so a missing or broken one is a real problem and
        // must not be papered over with a guess — a guessed port would probe the wrong thing.
        throw new Error(
          `agent/${file} has no usable AGENT_PORT (got ${JSON.stringify(raw)}). ` +
            `The console reads each agent's port from its own env file; there is no default.`,
        );
      }
      services.push({
        label: `${target}-agent`,
        envFile: join(agentDir, file),
        entryScript: join(agentDir, 'src', 'index.ts'),
        port,
      });
    }
  }

  if (existsSync(join(repoRoot, 'orchestrator', '.env'))) {
    services.push({
      label: 'orchestrator',
      envFile: join(repoRoot, 'orchestrator', '.env'),
      entryScript: join(repoRoot, 'orchestrator', 'src', 'index.ts'),
      port: undefined,
    });
  }

  return services;
}

/** One running process, as the OS describes it. */
export interface RunningProcess {
  readonly pid: number;
  readonly commandLine: string;
}

/**
 * Every `node` process on this machine, with its command line.
 *
 * Node has no process-enumeration API, so this asks Windows. Shelling out is mildly ugly and
 * chosen anyway: it adds **no dependency**, in a repository where adding one needs a
 * `DECISIONS.md` entry, and it is the same query `reveille.ps1` already made.
 */
export async function listNodeProcesses(): Promise<RunningProcess[]> {
  const script =
    "@(Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | " +
    'Select-Object ProcessId, CommandLine) | ConvertTo-Json -Depth 2 -Compress';
  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
    );
    const text = stdout.trim();
    if (text === '') return [];
    const parsed: unknown = JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .map((r) => r as { ProcessId?: number; CommandLine?: string | null })
      .filter((r) => typeof r.ProcessId === 'number' && typeof r.CommandLine === 'string')
      .map((r) => ({ pid: r.ProcessId as number, commandLine: r.CommandLine as string }));
  } catch {
    // An enumeration that fails must not be read as "nothing is running" — that would make
    // `plane down` silently succeed while everything kept running.
    throw new Error('Could not enumerate processes to identify Reveille’s own. Is PowerShell available?');
  }
}

/**
 * Is this process the given service?
 *
 * **Identity is what a process is RUNNING** — this entry script with this env file. Both
 * halves are required: the entry script alone would match every agent at once, and the env
 * file alone would match nothing useful. Path separators differ between how we store a path
 * and how a command line shows it, hence the normalisation.
 *
 * Exported so the Constitution IV guard is testable without spawning anything: a game
 * server, VLC, or an unrelated `node` process must be unmatchable **by construction**, not
 * by a filter applied afterwards that someone could forget.
 */
export function commandLineMatches(commandLine: string, service: PlaneService): boolean {
  // Windows reports a command line with backslashes and whatever casing the caller used, so
  // both sides are flattened before comparison. Paths here are absolute, which is what stops
  // a second checkout of this repository from matching (its root differs).
  const norm = (value: string): string => value.replace(/\\/g, '/').toLowerCase();
  const line = norm(commandLine);
  return line.includes(norm(service.entryScript)) && line.includes(norm(service.envFile));
}

/** Pair each service with the processes that are it. Pure — the enumeration is the caller's. */
export function matchProcesses(
  processes: readonly RunningProcess[],
  services: readonly PlaneService[],
): Map<string, RunningProcess[]> {
  const byLabel = new Map<string, RunningProcess[]>();
  for (const service of services) {
    byLabel.set(service.label, processes.filter((p) => commandLineMatches(p.commandLine, service)));
  }
  return byLabel;
}

/**
 * Reveille's own processes for these services.
 *
 * **Identity is what a process is running** — this entry script with this env file — never a
 * recorded id (FR-032). A stale pid file can point at a recycled pid after a reboot and kill
 * a stranger; "node running *this* script with *this* config" cannot accidentally be
 * someone's editor, or a game server, or VLC.
 */
export async function findServiceProcesses(
  services: readonly PlaneService[],
): Promise<Map<string, RunningProcess[]>> {
  return matchProcesses(await listNodeProcesses(), services);
}

/**
 * Does this service answer right now? Agents only — the orchestrator has no port.
 *
 * "The port is bound" is deliberately not enough: a half-initialised process can satisfy
 * that and answer nothing.
 */
export async function isAnswering(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(2_000) });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * Is this service **running** — whoever started it?
 *
 * Keyed off the process, not the log, and that distinction is load-bearing. A log line is
 * the right *readiness* signal for a service this console just launched, because we can
 * watch the fresh log from a known offset. It is the wrong *liveness* signal for a service
 * started any other way: there would be no log, and the console would report a running
 * orchestrator as down — and then `plane up` would start a **second** one, which for the
 * orchestrator means two bots answering the same guild.
 */
export async function isRunning(service: PlaneService): Promise<boolean> {
  const found = await findServiceProcesses([service]);
  return (found.get(service.label) ?? []).length > 0;
}

/** What happened to one service during a plane operation. */
export interface ServiceOutcome {
  readonly label: string;
  readonly state: 'up' | 'down' | 'failed' | 'skipped' | 'stopped';
  /** Operator detail — a log to read, a pid that was stopped. */
  readonly detail: string | undefined;
}

/**
 * Start the services that are down, then **verify each is actually serving** (FR-034).
 *
 * Reporting "started" for a process that already exited would be the silent wrong behaviour
 * the fail-loud config rule exists to prevent — every variable in this system is required
 * and throws at boot, so a misconfigured service dies within a second. That failure used to
 * be visible in the window the launcher spawned. **Removing the window is what creates the
 * obligation to check.**
 *
 * Spawn flags are the ones M0 measured (`m0-windows-spawn.md`): no window was created at
 * all — `conhost` count unchanged — and the child outlived its launcher.
 */
export async function planeUp(
  services: readonly PlaneService[],
  repoRoot: string,
  timeoutMs: number = READY_TIMEOUT_MS,
): Promise<ServiceOutcome[]> {
  const outcomes: ServiceOutcome[] = [];
  const alreadyRunning = await findServiceProcesses(services);

  for (const service of services) {
    // Idempotent, and keyed off the PROCESS rather than a probe or a log. An agent that is
    // up but wedged would still hold its port, so relaunching it would race for that port
    // and die on EADDRINUSE; and a service this console did not start has no log to read.
    // For the orchestrator the stake is higher than a crash — a second one is a second bot
    // answering the same guild (FR-030).
    if ((alreadyRunning.get(service.label) ?? []).length > 0) {
      outcomes.push({ label: service.label, state: 'skipped', detail: 'already running' });
      continue;
    }

    rotate(repoRoot, service.label);
    const path = logPath(repoRoot, service.label);
    const startedAt = logSize(path);
    const fd = openLog(repoRoot, service.label);

    spawn(process.execPath, [`--env-file=${service.envFile}`, service.entryScript], {
      cwd: repoRoot,
      detached: true, // outlive this console — the services are components, we are not
      windowsHide: true, // no console window, measured in M0
      stdio: ['ignore', fd, fd],
    }).unref();

    const ready =
      service.port !== undefined
        ? await waitForPort(service.port, timeoutMs)
        : await waitForLogLine(path, ORCHESTRATOR_READY, startedAt, timeoutMs);

    outcomes.push(
      ready
        ? { label: service.label, state: 'up', detail: service.port === undefined ? 'connected' : `:${service.port}` }
        : { label: service.label, state: 'failed', detail: logPath(repoRoot, service.label) },
    );
  }

  return outcomes;
}

/** Poll an agent's own `/status` until it answers 200, or the bound expires. */
async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(1_500) });
      if (res.status === 200) return true;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return false;
}

/**
 * Stop Reveille's own processes. **Never a controlled target** (FR-033).
 *
 * A game server and VLC are not node processes running one of our entry scripts, so the
 * matcher cannot select them. That is a property of how identity is defined, not a filter
 * applied afterwards that someone could forget.
 */
export async function planeDown(services: readonly PlaneService[]): Promise<ServiceOutcome[]> {
  const found = await findServiceProcesses(services);
  const outcomes: ServiceOutcome[] = [];

  for (const service of services) {
    const procs = found.get(service.label) ?? [];
    if (procs.length === 0) {
      outcomes.push({ label: service.label, state: 'down', detail: 'was not running' });
      continue;
    }
    for (const proc of procs) {
      try {
        process.kill(proc.pid);
      } catch {
        // Already gone between enumerating and killing. Nothing to do and nothing to report.
      }
    }
    outcomes.push({
      label: service.label,
      state: 'stopped',
      detail: `pid ${procs.map((p) => p.pid).join(', ')}`,
    });
  }

  return outcomes;
}

/**
 * Which services are running, worded so it cannot be mistaken for target state (FR-024).
 *
 * Liveness comes from the process — so a service started by hand, or before this feature
 * existed, reports honestly. For an agent the port is then probed as well, which separates
 * *running* from *answering*: a process that is up but wedged is `failed`, not `up`, because
 * calling it up is the same silent lie as calling a dead one started.
 */
export async function planeStatus(services: readonly PlaneService[]): Promise<ServiceOutcome[]> {
  const found = await findServiceProcesses(services);

  return Promise.all(
    services.map(async (service): Promise<ServiceOutcome> => {
      const procs = found.get(service.label) ?? [];
      if (procs.length === 0) {
        return { label: service.label, state: 'down', detail: 'no process' };
      }
      const pids = `pid ${procs.map((p) => p.pid).join(', ')}`;
      if (service.port === undefined) {
        return { label: service.label, state: 'up', detail: `${pids}; no port, dials out` };
      }
      return (await isAnswering(service.port))
        ? { label: service.label, state: 'up', detail: `:${service.port}, ${pids}` }
        : { label: service.label, state: 'failed', detail: `${pids} but not answering on :${service.port}` };
    }),
  );
}
