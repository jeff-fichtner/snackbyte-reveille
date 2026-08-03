import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createAgentServer } from './server.ts';
import type { GameAdapter } from './adapter.ts';

type DerivedState = 'running' | 'starting' | 'stopped';

/** A fake adapter — the server is game-agnostic, so a stub is enough to test it. */
function stub(state: DerivedState, over: Partial<GameAdapter> = {}): GameAdapter {
  return {
    getState: async () => state,
    start: () => {},
    stop: async () => {},
    ...over,
  };
}

/** Start the real server on an ephemeral loopback port; returns its base URL. */
async function startServer(adapter: GameAdapter): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createAgentServer(adapter);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test('GET /status returns 200 with the derived state, read-only', async () => {
  const { base, close } = await startServer(stub('running'));
  try {
    const res = await fetch(`${base}/status`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { state: 'running' });
  } finally {
    await close();
  }
});

test('POST /start on a stopped server launches (202) and calls the adapter', async () => {
  let started = false;
  const { base, close } = await startServer(stub('stopped', { start: () => { started = true; } }));
  try {
    const res = await fetch(`${base}/start`, { method: 'POST' });
    assert.equal(res.status, 202);
    assert.equal(started, true);
  } finally {
    await close();
  }
});

test('the router rejects a non-POST command verb (405) and unknown paths (404)', async () => {
  const { base, close } = await startServer(stub('stopped'));
  try {
    assert.equal((await fetch(`${base}/start`)).status, 405, 'GET /start should be 405');
    assert.equal((await fetch(`${base}/nope`, { method: 'POST' })).status, 404, 'unknown path should be 404');
  } finally {
    await close();
  }
});

test('/status runs OFF the command mutex — it answers while a /stop is mid-flight (DECISIONS 014)', async () => {
  let enteredStop = (): void => {};
  let releaseStop = (): void => {};
  const stopEntered = new Promise<void>((resolve) => { enteredStop = resolve; });
  const stopGate = new Promise<void>((resolve) => { releaseStop = resolve; });

  // stop() blocks inside the mutex until we release it.
  const { base, close } = await startServer(
    stub('running', { stop: async () => { enteredStop(); await stopGate; } }),
  );
  try {
    // Fire a /stop; it acquires the command mutex and blocks inside stop().
    const stopDone = fetch(`${base}/stop`, { method: 'POST' });
    await stopEntered; // the mutex is now held by the in-flight stop

    // /status MUST still answer. If it were serialized it would queue behind the
    // blocked /stop and never resolve; the abort turns that deadlock into a failure.
    const statusRes = await fetch(`${base}/status`, { signal: AbortSignal.timeout(3_000) });
    assert.equal(statusRes.status, 200, '/status was blocked behind the in-flight /stop');
    assert.deepEqual(await statusRes.json(), { state: 'running' });

    releaseStop();
    assert.equal((await stopDone).status, 200);
  } finally {
    releaseStop(); // ensure the server can close even if an assertion threw
    await close();
  }
});
