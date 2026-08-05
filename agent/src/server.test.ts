import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createAgentServer } from './server.ts';
import type { Adapter, GameAdapter, MediaAdapter } from './adapter.ts';
import type { MediaState } from '@reveille/contract';

type DerivedState = 'running' | 'starting' | 'stopped';

/** A fake game adapter — the server is target-agnostic, so a stub is enough. */
function stub(state: DerivedState, over: Partial<GameAdapter> = {}): GameAdapter {
  return {
    kind: 'game',
    getState: async () => state,
    start: () => {},
    stop: async () => {},
    ...over,
  };
}

/** A fake media adapter, for the server's kind-dispatch of `/pause`·`/play`. */
function mediaStub(state: MediaState, over: Partial<MediaAdapter> = {}): MediaAdapter {
  return {
    kind: 'media',
    getState: async () => state,
    pause: async () => {},
    resume: async () => {},
    ...over,
  };
}

/** Start the real server on an ephemeral loopback port; returns its base URL. */
async function startServer(adapter: Adapter): Promise<{ base: string; close: () => Promise<void> }> {
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

test('a media adapter answers /pause and /play, and /status, by kind (003)', async () => {
  let paused = false;
  let resumed = false;
  const { base, close } = await startServer(
    mediaStub('playing', {
      pause: async () => { paused = true; },
      resume: async () => { resumed = true; },
    }),
  );
  try {
    const p = await fetch(`${base}/pause`, { method: 'POST' });
    assert.equal(p.status, 200);
    assert.deepEqual(await p.json(), { state: 'paused' });
    assert.equal(paused, true, 'the adapter pause() was not called');

    // resume() is reached only when not already playing — flip the stub's read.
    const { base: b2, close: c2 } = await startServer(
      mediaStub('paused', { resume: async () => { resumed = true; } }),
    );
    try {
      const r = await fetch(`${b2}/play`, { method: 'POST' });
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), { state: 'playing' });
      assert.equal(resumed, true, 'the adapter resume() was not called');
    } finally {
      await c2();
    }

    const s = await fetch(`${base}/status`);
    assert.equal(s.status, 200);
    assert.deepEqual(await s.json(), { state: 'playing' });
  } finally {
    await close();
  }
});

test('a media command with nothing playing is refused (409), and a no-op reports 200 (FR-007/008)', async () => {
  const stopped = await startServer(mediaStub('stopped'));
  try {
    assert.equal((await fetch(`${stopped.base}/pause`, { method: 'POST' })).status, 409, 'pause with nothing playing');
    assert.equal((await fetch(`${stopped.base}/play`, { method: 'POST' })).status, 409, 'play with nothing loaded');
  } finally {
    await stopped.close();
  }

  const alreadyPaused = await startServer(mediaStub('paused'));
  try {
    const res = await fetch(`${alreadyPaused.base}/pause`, { method: 'POST' });
    assert.equal(res.status, 200, 'already paused is a reported no-op, not a failure');
    const body = (await res.json()) as { message?: string };
    assert.match(body.message ?? '', /already paused/i);
  } finally {
    await alreadyPaused.close();
  }
});

test('the kinds never cross: a game 404s the media verbs, a media 404s the game verbs (SC-007)', async () => {
  const game = await startServer(stub('stopped'));
  try {
    assert.equal((await fetch(`${game.base}/pause`, { method: 'POST' })).status, 404, 'a game must not answer /pause');
    assert.equal((await fetch(`${game.base}/play`, { method: 'POST' })).status, 404, 'a game must not answer /play');
  } finally {
    await game.close();
  }

  const media = await startServer(mediaStub('playing'));
  try {
    assert.equal((await fetch(`${media.base}/start`, { method: 'POST' })).status, 404, 'a media target must not answer /start');
    assert.equal((await fetch(`${media.base}/stop`, { method: 'POST' })).status, 404, 'a media target must not answer /stop');
  } finally {
    await media.close();
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
