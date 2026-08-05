import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createAgentServer } from './server.ts';
import type { Adapter, GameAdapter, MediaAdapter } from './adapter.ts';
import type { MediaState, AgentResponse } from '@reveille/contract';

/** `Response.json()` is `unknown`; every agent reply is an `AgentResponse` by contract. */
const body = async (res: Response): Promise<AgentResponse> => (await res.json()) as AgentResponse;

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
    seek: async () => {},
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

test('POST /seek requires an integer `seconds` and never invents a default (005, M0 §6)', async () => {
  const seen: number[] = [];
  const { base, close } = await startServer(
    mediaStub('playing', { seek: async (s: number) => { seen.push(s); } }),
  );
  try {
    // Missing / blank / non-integer are CALLER BUGS: 400, naming the parameter. M0 §6
    // measured VLC parsing `val=abc` as 0 and seeking absolutely to the start, so a
    // silent default here would be destructive rather than merely wrong.
    for (const q of ['', '?seconds=', '?seconds=abc', '?seconds=1.5', '?seconds=1e3', '?seconds=0x1f']) {
      const res = await fetch(`${base}/seek${q}`, { method: 'POST' });
      assert.equal(res.status, 400, `\`${q}\` must be refused, not defaulted`);
      assert.match((await body(res)).message ?? '', /seconds/, 'the 400 must name the parameter');
    }
    assert.deepEqual(seen, [], 'no malformed request may reach the adapter');

    // A well-formed amount reaches the adapter EXACTLY as given — no magnitude
    // conversion, no clamping, no range check (FR-005).
    for (const q of ['30', '-30', '0', '-0', '99999']) {
      const res = await fetch(`${base}/seek?seconds=${q}`, { method: 'POST' });
      assert.equal(res.status, 200);
      // 200 means ISSUED — the body reports the state we read, never where it landed.
      assert.deepEqual(await res.json(), { state: 'playing' });
    }
    assert.deepEqual(seen, [30, -30, 0, -0, 99999], 'the amount must pass through untouched');
  } finally {
    await close();
  }
});

test('POST /seek refuses when nothing is loaded, and reports adapter failure (FR-006)', async () => {
  const stoppedSrv = await startServer(mediaStub('stopped'));
  try {
    const res = await fetch(`${stoppedSrv.base}/seek?seconds=30`, { method: 'POST' });
    assert.equal(res.status, 409, 'nothing loaded must be refused honestly, like /pause');
    assert.deepEqual(await res.json(), { state: 'stopped', message: 'Nothing is playing.' });
  } finally {
    await stoppedSrv.close();
  }

  // Paused is NOT a refusal — the item is loaded, so the player can act.
  const pausedSrv = await startServer(mediaStub('paused'));
  try {
    const res = await fetch(`${pausedSrv.base}/seek?seconds=30`, { method: 'POST' });
    assert.equal(res.status, 200, 'a paused player is loaded and can be seeked');
  } finally {
    await pausedSrv.close();
  }

  const brokenSrv = await startServer(
    mediaStub('playing', { seek: async () => { throw new Error('player unreachable'); } }),
  );
  try {
    const res = await fetch(`${brokenSrv.base}/seek?seconds=30`, { method: 'POST' });
    assert.equal(res.status, 500);
    assert.equal((await body(res)).state, 'error');
  } finally {
    await brokenSrv.close();
  }
});

test('a game agent 404s /seek — the kinds never cross (FR-016)', async () => {
  const { base, close } = await startServer(stub('running'));
  try {
    assert.equal((await fetch(`${base}/seek?seconds=30`, { method: 'POST' })).status, 404);
  } finally {
    await close();
  }
});

test('/seek runs ON the command mutex, while /status still answers (FR-021)', async () => {
  let enteredSeek = (): void => {};
  let releaseSeek = (): void => {};
  const seekEntered = new Promise<void>((resolve) => { enteredSeek = resolve; });
  const seekGate = new Promise<void>((resolve) => { releaseSeek = resolve; });

  const { base, close } = await startServer(
    mediaStub('playing', { seek: async () => { enteredSeek(); await seekGate; } }),
  );
  try {
    const first = fetch(`${base}/seek?seconds=30`, { method: 'POST' });
    await seekEntered; // the mutex is now held by the in-flight seek

    // A SECOND acting verb must queue behind it — two controls may never race the
    // player (FR-021). If it were not serialized this would resolve immediately.
    let secondSettled = false;
    const second = fetch(`${base}/pause`, { method: 'POST' }).then((r) => { secondSettled = true; return r; });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(secondSettled, false, '/pause must wait for the in-flight /seek');

    // ...but the read-only /status must NOT be stalled behind it.
    const statusRes = await fetch(`${base}/status`, { signal: AbortSignal.timeout(3_000) });
    assert.equal(statusRes.status, 200, '/status was blocked behind the in-flight /seek');

    releaseSeek();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
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
