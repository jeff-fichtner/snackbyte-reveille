import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createAgentServer, waitUntilStopped } from './server.ts';
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
    // Default: a player that reports nothing but its state — the shape a game agent and
    // an older media agent both produce, so every pre-007 test still exercises the
    // "no detail available" path (FR-009, SC-011).
    observe: async () => ({ state }),
    pause: async () => {},
    resume: async () => {},
    seek: async () => {},
    next: async () => {},
    previous: async () => {},
    ...over,
  };
}

/** Start the real server on an ephemeral loopback port; returns its base URL. */
async function startServer(
  adapter: Adapter,
  exitTimeoutMs?: number,
  exitPollMs?: number,
): Promise<{ base: string; close: () => Promise<void> }> {
  const server = createAgentServer(adapter, exitTimeoutMs, exitPollMs);
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
    for (const q of [
      '', '?seconds=', '?seconds=abc', '?seconds=1.5', '?seconds=1e3', '?seconds=0x1f',
      // Beyond MAX_SAFE_INTEGER a JS number cannot hold the value: 9007199254740993
      // silently becomes …992, and 1e21 stringifies to `1e+21` — a malformed `val` on
      // the wire. FR-004 says "exactly as given", so this fails loud (T027).
      '?seconds=9007199254740993', '?seconds=1000000000000000000000',
      '?seconds=-9007199254740993',
    ]) {
      const res = await fetch(`${base}/seek${q}`, { method: 'POST' });
      assert.equal(res.status, 400, `\`${q}\` must be refused, not defaulted`);
      assert.match((await body(res)).message ?? '', /seconds/, 'the 400 must name the parameter');
    }
    assert.deepEqual(seen, [], 'no malformed request may reach the adapter');

    // A well-formed amount reaches the adapter EXACTLY as given — no magnitude
    // conversion, no clamping, no range check (FR-005).
    // The safe-integer boundary itself is ACCEPTED — the guard refuses only what cannot
    // be represented, and clamps nothing inside the range (FR-005).
    for (const q of ['30', '-30', '0', '-0', '99999', '9007199254740991', '-9007199254740991']) {
      const res = await fetch(`${base}/seek?seconds=${q}`, { method: 'POST' });
      assert.equal(res.status, 200);
      // 200 means ISSUED — the body reports the state we read, never where it landed.
      assert.deepEqual(await res.json(), { state: 'playing' });
    }
    assert.deepEqual(
      seen,
      [30, -30, 0, -0, 99999, 9007199254740991, -9007199254740991],
      'the amount must pass through untouched',
    );
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

test('POST /next and /previous step, refuse on stopped, and read no parameters (005)', async () => {
  // Acts when the item is loaded — playing AND paused. Paused is not a refusal: the item
  // is loaded, so the player can act (M0 §7 measured a step resuming a paused player).
  for (const state of ['playing', 'paused'] as const) {
    const calls: string[] = [];
    const { base, close } = await startServer(
      mediaStub(state, {
        next: async () => { calls.push('next'); },
        previous: async () => { calls.push('previous'); },
      }),
    );
    try {
      for (const verb of ['next', 'previous']) {
        const res = await fetch(`${base}/${verb}?count=1`, { method: 'POST' });
        assert.equal(res.status, 200, `/${verb} must act while ${state}`);
        // 200 means ISSUED — the body reports the state we read, never a claim that the
        // item changed. M0 §8: VLC wraps at the boundary and we never look.
        assert.deepEqual(await body(res), { state });
      }
      assert.deepEqual(calls, ['next', 'previous']);

      // The line DECISIONS 023 draws, now that a step carries one parameter: a parameter
      // of the OPERATION may cross; a name for WHICH ITEM may not. `count` is honoured;
      // an id or an index is ignored outright, because there is nothing in the agent that
      // would read one — there is no smuggling route, not merely an unused branch.
      calls.length = 0;
      assert.equal((await fetch(`${base}/next?count=1&plid=7&index=2`, { method: 'POST' })).status, 200);
      assert.deepEqual(calls, ['next'], 'an item identifier must not change what a step does');
    } finally {
      await close();
    }
  }

  // Nothing loaded: refused in the SAME terms as /pause and /seek (SC-003). M0 §9 measured
  // both stepping commands no-opping silently while still answering 200, so forwarding
  // blind would report success for an action that did not happen.
  const stoppedSrv = await startServer(mediaStub('stopped'));
  try {
    for (const verb of ['next', 'previous']) {
      // `count` is validated BEFORE the state is read, exactly as `/seek` validates
      // `seconds` first: a malformed request is the caller's bug whatever the player is
      // doing, and answering 409 to a request we never understood would be a worse answer.
      const res = await fetch(`${stoppedSrv.base}/${verb}?count=1`, { method: 'POST' });
      assert.equal(res.status, 409);
      assert.deepEqual(await body(res), { state: 'stopped', message: 'Nothing is playing.' });
    }
  } finally {
    await stoppedSrv.close();
  }

  const brokenSrv = await startServer(
    mediaStub('playing', { next: async () => { throw new Error('player unreachable'); } }),
  );
  try {
    const res = await fetch(`${brokenSrv.base}/next?count=1`, { method: 'POST' });
    assert.equal(res.status, 500);
    assert.equal((await body(res)).state, 'error');
  } finally {
    await brokenSrv.close();
  }

  // The kinds never cross (FR-016).
  const game = await startServer(stub('running'));
  try {
    assert.equal((await fetch(`${game.base}/next`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${game.base}/previous`, { method: 'POST' })).status, 404);
  } finally {
    await game.close();
  }
});

test('/next runs ON the command mutex, while /status still answers (FR-021)', async () => {
  let enteredNext = (): void => {};
  let releaseNext = (): void => {};
  const nextEntered = new Promise<void>((resolve) => { enteredNext = resolve; });
  const nextGate = new Promise<void>((resolve) => { releaseNext = resolve; });

  const { base, close } = await startServer(
    mediaStub('playing', { next: async () => { enteredNext(); await nextGate; } }),
  );
  try {
    const first = fetch(`${base}/next?count=1`, { method: 'POST' });
    await nextEntered;

    let secondSettled = false;
    const second = fetch(`${base}/previous?count=1`, { method: 'POST' }).then((r) => { secondSettled = true; return r; });
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(secondSettled, false, '/previous must wait for the in-flight /next');

    const statusRes = await fetch(`${base}/status`, { signal: AbortSignal.timeout(3_000) });
    assert.equal(statusRes.status, 200, '/status was blocked behind the in-flight /next');

    releaseNext();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
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

  // stop() blocks inside the mutex until we release it, then the process "exits" — which
  // `/stop` now waits to observe before it answers, so the stub has to actually go down.
  let state: DerivedState = 'running';
  const { base, close } = await startServer(
    stub('running', {
      getState: async () => state,
      stop: async () => {
        enteredStop();
        await stopGate;
        state = 'stopped';
      },
    }),
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

test('POST /stop answers 200 only once the process is actually GONE, never on acceptance alone', async () => {
  // The reported bug: the shutdown API returns immediately, the process lingers for
  // seconds, and the old handler answered `stopped` without looking. Here the stub stays
  // up for two polls after stop() resolves — a 200 that arrives before it goes down would
  // be the same false claim.
  let state: DerivedState = 'running';
  let readsAfterStop = 0;
  let stopReturned = false;
  const { base, close } = await startServer(
    stub('running', {
      getState: async () => {
        if (stopReturned && ++readsAfterStop >= 3) state = 'stopped';
        return state;
      },
      stop: async () => { stopReturned = true; },
    }),
    5_000,
    20,
  );
  try {
    const res = await fetch(`${base}/stop`, { method: 'POST' });
    assert.equal(res.status, 200);
    assert.deepEqual(await body(res), { state: 'stopped' });
    assert.ok(readsAfterStop >= 3, 'it answered without waiting for the process to leave');
    assert.equal(state, 'stopped');
  } finally {
    await close();
  }
});

test('POST /stop that cannot confirm the exit answers 202 — saved and shutting down, not failed', async () => {
  // A process that never leaves: `running` for the pre-stop check, then `starting` for
  // ever after — a live process whose API has gone, which is exactly what a real server
  // looks like while it winds down. This must NOT read as the 500 (which means the world
  // may be at risk and the server is still up) and must NOT read as the 200 (which claims
  // it is down). The state reported is the one actually observed, never a stand-in.
  let stopReturned = false;
  const { base, close } = await startServer(
    stub('running', {
      getState: async () => (stopReturned ? 'starting' : 'running'),
      stop: async () => { stopReturned = true; },
    }),
    // A short bound, so the test exercises the real HTTP path without waiting 15s.
    150,
    50,
  );
  try {
    const res = await fetch(`${base}/stop`, { method: 'POST' });
    assert.equal(res.status, 202, 'accepted-but-unconfirmed is neither 200 nor 500');
    const b = await body(res);
    assert.equal(b.state, 'starting', 'reports what it observed — a process still exists');
    assert.match(b.message ?? '', /saved/i, 'the operator detail must say the world is safe');
  } finally {
    await close();
  }
});

test('waitUntilStopped returns the last state it OBSERVED, and gives up at the bound', async () => {
  // Driven by a fake clock, so the real 15s bound costs nothing here (mirrors watchUntilUp).
  const clock = { t: 0, now(): number { return this.t; }, async sleep(ms: number) { this.t += ms; } };

  let reads = 0;
  assert.equal(
    await waitUntilStopped(async () => (++reads >= 4 ? 'stopped' : 'starting'), 10_000, clock, 500),
    'stopped',
    'it should keep looking until the process leaves',
  );
  assert.equal(reads, 4);

  clock.t = 0;
  assert.equal(
    await waitUntilStopped(async () => 'starting', 1_000, clock, 500),
    'starting',
    'at the bound it reports the last observation, not a verdict and not a guess',
  );

  clock.t = 0;
  assert.equal(
    await waitUntilStopped(async () => { throw new Error('unreachable'); }, 1_000, clock, 500),
    undefined,
    'a read that never succeeds observed nothing, and must not invent a state',
  );
});

test('a read that fails mid-wait must not turn a completed shutdown into a failure', async () => {
  const clock = { t: 0, now(): number { return this.t; }, async sleep(ms: number) { this.t += ms; } };
  let reads = 0;
  const flaky = async (): Promise<'stopped' | 'starting'> => {
    reads += 1;
    if (reads === 2) throw new Error('probe blipped');
    return reads >= 4 ? 'stopped' : 'starting';
  };
  assert.equal(await waitUntilStopped(flaky, 10_000, clock, 500), 'stopped');
});

test('007 T031 — a MULTI-item step is indivisible, and /status still answers (FR-019)', async () => {
  // The existing mutex test proves one step serialises. This proves the property that
  // actually matters for 007: a count of N is ONE operation, not N chances for another
  // command to land in the middle. A loop written outside the mutex hold would pass the
  // single-step test and fail this one.
  let steps = 0;
  let enteredFirst = (): void => {};
  const firstEntered = new Promise<void>((resolve) => { enteredFirst = resolve; });
  let release = (): void => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const { base, close } = await startServer(
    mediaStub('playing', {
      next: async (count: number) => {
        for (let i = 0; i < count; i++) {
          steps++;
          if (steps === 1) { enteredFirst(); await gate; }
        }
      },
      pause: async () => { throw new Error('pause landed in the middle of a multi-step'); },
    }),
  );
  try {
    const stepping = fetch(`${base}/next?count=4`, { method: 'POST' });
    await firstEntered;

    // Mid-sequence: another acting command must NOT be admitted...
    let pauseSettled = false;
    const paused = fetch(`${base}/pause`, { method: 'POST' }).then((r) => { pauseSettled = true; return r; });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(pauseSettled, false, 'a command landed inside an in-flight multi-step');
    assert.equal(steps, 1, 'the sequence advanced past its gate while another command waited');

    // ...but `/status` must, because it deliberately does not sit on the command mutex.
    const status = await fetch(`${base}/status`);
    assert.equal(status.status, 200, '/status stalled behind a long step — it must stay off the mutex');
    assert.deepEqual(await status.json(), { state: 'playing' });

    release();
    assert.equal((await stepping).status, 200);
    assert.equal(steps, 4, 'the whole count must run as one operation');
    await paused; // it throws inside the adapter, so it answers 500 — it merely must not run EARLY
  } finally {
    await close();
  }
});

test('007 — EVERY media verb reports what it observed, none silently omits it (FR-008)', async () => {
  // Written as a sweep rather than per-verb because the bug it exists for was an OMISSION:
  // /play's acting branch carried a comment claiming it reported detail while the code did
  // not, and /seek reported nothing at all. Checking verbs one at a time is exactly how
  // both went unnoticed — a per-verb test only fails for the verb somebody remembered.
  const seen = { state: 'playing' as const, title: 'Some Show', elapsedSeconds: 61, totalSeconds: 125 };

  // /play acts only when paused, so it needs its own stub; the rest act while playing.
  const cases: { verb: string; state: 'playing' | 'paused' }[] = [
    { verb: '/pause', state: 'playing' },
    { verb: '/play', state: 'paused' },
    { verb: '/seek?seconds=30', state: 'playing' },
    { verb: '/next?count=1', state: 'playing' },
    { verb: '/previous?count=1', state: 'playing' },
  ];

  for (const { verb, state } of cases) {
    const { base, close } = await startServer(
      mediaStub(state, { observe: async () => ({ ...seen, state }) }),
    );
    try {
      const res = await fetch(`${base}${verb}`, { method: 'POST' });
      assert.equal(res.status, 200, `${verb} should have acted`);
      const b = await body(res);
      assert.equal(b.title, 'Some Show', `${verb} did not report what it observed`);
      assert.equal(b.elapsedSeconds, 61, `${verb} omitted the position`);
      assert.equal(b.totalSeconds, 125, `${verb} omitted the duration`);
    } finally {
      await close();
    }
  }

  // And a target that reports nothing still answers cleanly — absent stays absent (FR-009).
  const bare = await startServer(mediaStub('playing'));
  try {
    const b = await body(await fetch(`${bare.base}/pause`, { method: 'POST' }));
    assert.equal('title' in b, false, 'a missing reading must not become a present field');
    assert.equal(b.state, 'paused');
  } finally {
    await bare.close();
  }
});
