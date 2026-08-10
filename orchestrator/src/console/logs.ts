/**
 * Where a service's output goes, now that no window holds it (008 FR-027 – FR-029).
 *
 * Hiding the windows and writing these files are **one change, not two**. Those windows
 * were the only log view: `-NoExit` is how the `10062` orchestrator crash in 006 T014 was
 * diagnosable at all. Hide them without redirecting and the next crash is silent — a
 * regression dressed as a cleanup.
 *
 * **At most one prior generation is kept** (FR-028). Truncating instead would destroy the
 * crash log in the exact situation you are restarting *because of* a crash; keeping many
 * would grow without bound. One is the smallest number that survives the case that matters.
 *
 * A log is output for a human. The console never reads one back to make a decision — with
 * one bounded exception that is a *live* read rather than a memory: `plane up` watches the
 * orchestrator's current log for its ready line, because the orchestrator has no port to
 * probe. It draws no conclusion from a previous run.
 */
import { createReadStream, existsSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

/** The directory holding every service's log. Gitignored — operator data, never committed. */
export function logDir(repoRoot: string): string {
  return join(repoRoot, 'logs');
}

export function logPath(repoRoot: string, label: string): string {
  return join(logDir(repoRoot), `${label}.log`);
}

/** The one prior generation. There is deliberately no `.log.2`. */
export function previousLogPath(repoRoot: string, label: string): string {
  return `${logPath(repoRoot, label)}.1`;
}

/**
 * Roll the current log to the prior generation and return the path to write fresh.
 *
 * Called once per service at `plane up`. A service that has never run simply has no
 * generation to roll.
 */
export function rotate(repoRoot: string, label: string): string {
  mkdirSync(logDir(repoRoot), { recursive: true });
  const current = logPath(repoRoot, label);
  if (!existsSync(current)) return current;

  const previous = previousLogPath(repoRoot, label);
  // Replacing the older generation is the bound. `renameSync` overwrites on POSIX but
  // throws on Windows when the destination exists, so the old one goes first — explicitly,
  // because this is the line that decides logs cannot accumulate.
  if (existsSync(previous)) unlinkSync(previous);
  renameSync(current, previous);
  return current;
}

/** Open a service's log for appending, as the file descriptor `spawn` redirects into. */
export function openLog(repoRoot: string, label: string): number {
  mkdirSync(logDir(repoRoot), { recursive: true });
  return openSync(logPath(repoRoot, label), 'a');
}

/**
 * Wait for a line matching `pattern` to appear in a service's log.
 *
 * This is the orchestrator's readiness probe. It has no inbound port — the property 008
 * protects — so there is nothing to poll, and inventing one would be the exact mistake this
 * feature avoids. It already announces itself on stdout, and as of this feature stdout is a
 * file we control: **the readiness signal was always there; redirecting the output is what
 * makes it readable.**
 *
 * Reads only the CURRENT generation, and only from the offset the file had when the service
 * was launched, so a previous run's ready line can never be mistaken for this one's.
 */
export async function waitForLogLine(
  path: string,
  pattern: RegExp,
  fromOffset: number,
  timeoutMs: number,
  intervalMs = 200,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (existsSync(path) && statSync(path).size > fromOffset) {
      const stream = createReadStream(path, { start: fromOffset, encoding: 'utf8' });
      try {
        for await (const line of createInterface({ input: stream, crlfDelay: Infinity })) {
          if (pattern.test(line)) return true;
        }
      } finally {
        stream.close();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return false;
}

/** Where a service's log currently ends — the offset a readiness watch starts from. */
export function logSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

/**
 * The recent output of several services, merged into one labelled view (FR-029).
 *
 * This is what replaces the four windows. Each line is prefixed with the service it came
 * from, because the whole point is reading them together — a crash in the orchestrator is
 * usually interesting next to what the agents were doing.
 *
 * **A snapshot, not a `tail -f`.** A continuous follow would run until interrupted, which
 * sits badly with the always-terminates rule the console lives under
 * (`contracts/console-surface.md` §6): the command would never produce an exit code. The
 * files are named in the output, so following one with whatever tool you like stays easy.
 */
export function mergedTail(
  repoRoot: string,
  labels: readonly string[],
  linesPerService = 20,
): string {
  const width = Math.max(0, ...labels.map((l) => l.length));
  const sections: string[] = [];

  for (const label of labels) {
    const path = logPath(repoRoot, label);
    if (!existsSync(path)) {
      sections.push(`${label.padEnd(width)} │ (no log yet — this service has not run since logging began)`);
      continue;
    }
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).filter((l: string) => l.trim() !== '');
    const recent = lines.slice(-linesPerService);
    if (recent.length === 0) {
      sections.push(`${label.padEnd(width)} │ (log is empty)`);
      continue;
    }
    for (const line of recent) sections.push(`${label.padEnd(width)} │ ${line}`);
  }

  return sections.join('\n');
}
