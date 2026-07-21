import test from 'node:test';
import assert from 'node:assert/strict';
import { serialize } from './serialize.ts';

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('serialize runs tasks one at a time, never overlapping', async () => {
  let active = 0;
  let maxActive = 0;

  const task = async () => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await tick(5);
    active -= 1;
  };

  await Promise.all([serialize(task), serialize(task), serialize(task), serialize(task)]);

  assert.equal(maxActive, 1, 'two tasks were in flight at once');
});

test('serialize preserves submission order', async () => {
  const order: number[] = [];
  await Promise.all(
    [30, 20, 10, 0].map((delay, i) =>
      serialize(async () => {
        await tick(delay);
        order.push(i);
      }),
    ),
  );
  assert.deepEqual(order, [0, 1, 2, 3], 'a later task overtook an earlier one');
});

test('a rejected task does not wedge the queue', async () => {
  await assert.rejects(serialize(async () => Promise.reject(new Error('boom'))));
  assert.equal(await serialize(async () => 'still works'), 'still works');
});

test('the check-then-act race FR-008 forbids cannot happen', async () => {
  // Two /start requests arriving together. Without serialization both read
  // `stopped` before either spawns, and both launch a server.
  let state: 'stopped' | 'running' = 'stopped';
  let spawns = 0;

  const start = async () => {
    const seen = state; // read
    await tick(5); // the await where interleaving used to happen
    if (seen === 'running') return 'refused';
    spawns += 1; // act
    state = 'running';
    return 'started';
  };

  const [a, b] = await Promise.all([serialize(start), serialize(start)]);

  assert.equal(spawns, 1, 'a second server was launched (FR-008)');
  assert.deepEqual([a, b], ['started', 'refused'], 'commands did not resolve to one clean winner');
});
