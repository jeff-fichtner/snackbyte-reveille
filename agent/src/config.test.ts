import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, required, requiredPositiveInt } from './config.ts';

const complete = {
  AGENT_PORT: '8300',
  PALWORLD_EXE_PATH: 'C:\\PalServer\\PalServer.exe',
  PALWORLD_REST_BASE_URL: 'http://127.0.0.1:8212',
  PALWORLD_ADMIN_PASSWORD: 'not-blank',
  STOP_TIMEOUT_MS: '30000',
} satisfies NodeJS.ProcessEnv;

test('a complete environment loads', () => {
  const config = loadConfig({ ...complete });
  assert.equal(config.port, 8300);
  assert.equal(config.stopTimeoutMs, 30000);
  assert.equal(config.palworldAdminPassword, 'not-blank');
});

test('every required variable fails loudly by name when missing', () => {
  for (const key of Object.keys(complete)) {
    const env = { ...complete };
    delete env[key as keyof typeof complete];
    assert.throws(() => loadConfig(env), new RegExp(key), `${key} was allowed to be missing`);
  }
});

test('a blank value is treated as missing, not as an empty default', () => {
  // The one that matters most: a blank AdminPassword is an open admin interface.
  assert.throws(
    () => loadConfig({ ...complete, PALWORLD_ADMIN_PASSWORD: '   ' }),
    /PALWORLD_ADMIN_PASSWORD/,
  );
});

test('the stop bound must be a positive integer (FR-007)', () => {
  for (const bad of ['0', '-1', 'soon', '1.5', '']) {
    assert.throws(
      () => loadConfig({ ...complete, STOP_TIMEOUT_MS: bad }),
      /STOP_TIMEOUT_MS/,
      `STOP_TIMEOUT_MS accepted ${JSON.stringify(bad)}`,
    );
  }
});

test('a trailing slash on the REST base URL is normalised away', () => {
  const config = loadConfig({ ...complete, PALWORLD_REST_BASE_URL: 'http://127.0.0.1:8212///' });
  assert.equal(config.palworldRestBaseUrl, 'http://127.0.0.1:8212');
});

test('required/requiredPositiveInt name the variable in the error', () => {
  assert.throws(() => required('NOPE', {}), /NOPE/);
  assert.throws(() => requiredPositiveInt('ALSO_NOPE', { ALSO_NOPE: 'x' }), /ALSO_NOPE/);
});
