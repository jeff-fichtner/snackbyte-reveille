import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logDir, logPath, previousLogPath, rotate, logSize, waitForLogLine } from './logs.ts';

function scratch(): string {
  return mkdtempSync(join(tmpdir(), 'reveille-logs-'));
}

test('a first-ever run has ONE generation, not an empty second one', () => {
  const root = scratch();
  try {
    const path = rotate(root, 'palworld-agent');
    assert.equal(path, logPath(root, 'palworld-agent'));
    assert.equal(existsSync(previousLogPath(root, 'palworld-agent')), false, 'nothing to roll yet');
    assert.ok(existsSync(logDir(root)), 'the log directory is created on demand');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('rotation preserves the previous run and starts fresh (FR-028)', () => {
  const root = scratch();
  try {
    mkdirSync(logDir(root), { recursive: true });
    writeFileSync(logPath(root, 'orchestrator'), 'run one\n', 'utf8');

    rotate(root, 'orchestrator');
    assert.equal(readFileSync(previousLogPath(root, 'orchestrator'), 'utf8'), 'run one\n');
    assert.equal(existsSync(logPath(root, 'orchestrator')), false, 'the current log starts empty');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('AT MOST two generations ever exist — restarting cannot accumulate logs', () => {
  const root = scratch();
  try {
    mkdirSync(logDir(root), { recursive: true });
    for (const run of ['one', 'two', 'three', 'four']) {
      writeFileSync(logPath(root, 'vlc-agent'), `run ${run}\n`, 'utf8');
      rotate(root, 'vlc-agent');
    }

    assert.equal(readFileSync(previousLogPath(root, 'vlc-agent'), 'utf8'), 'run four\n', 'the newest prior run wins');
    assert.equal(existsSync(`${logPath(root, 'vlc-agent')}.2`), false, 'there is deliberately no .log.2');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('restarting to chase a crash never destroys the crash log', () => {
  // The whole reason rotation exists rather than truncation: the run you are investigating
  // is the one immediately before the restart.
  const root = scratch();
  try {
    mkdirSync(logDir(root), { recursive: true });
    writeFileSync(logPath(root, 'orchestrator'), 'Error: 10062 Unknown interaction\n', 'utf8');

    rotate(root, 'orchestrator');

    assert.match(
      readFileSync(previousLogPath(root, 'orchestrator'), 'utf8'),
      /10062/,
      'the crash that made you restart must survive the restart',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a readiness watch reads only from where the log stood at launch', async () => {
  const root = scratch();
  try {
    mkdirSync(logDir(root), { recursive: true });
    const path = logPath(root, 'orchestrator');
    // A PREVIOUS run's ready line, already in the file.
    writeFileSync(path, 'orchestrator connected as old#1234\n', 'utf8');
    const offset = logSize(path);

    // Nothing new arrives, so the watch must NOT be satisfied by the stale line.
    const stale = await waitForLogLine(path, /orchestrator connected as /, offset, 300, 50);
    assert.equal(stale, false, 'a previous run’s ready line is not this run’s');

    // Now this run writes its own.
    writeFileSync(path, 'orchestrator connected as new#5678\n', { flag: 'a' });
    const fresh = await waitForLogLine(path, /orchestrator connected as /, offset, 1_000, 50);
    assert.equal(fresh, true, 'the line written after launch does satisfy it');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a watch on a service that never becomes ready terminates (always-terminates)', async () => {
  const root = scratch();
  try {
    mkdirSync(logDir(root), { recursive: true });
    const path = logPath(root, 'palworld-agent');
    writeFileSync(path, 'Missing required environment variable PALWORLD_ADMIN_PASSWORD\n', 'utf8');

    const started = Date.now();
    const ready = await waitForLogLine(path, /never appears/, 0, 300, 50);

    assert.equal(ready, false, 'it gives up rather than hanging');
    assert.ok(Date.now() - started < 3_000, 'and gives up near its bound');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('logSize is zero for a log that does not exist yet', () => {
  const root = scratch();
  try {
    assert.equal(logSize(logPath(root, 'never-run')), 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
