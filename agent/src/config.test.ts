import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, required, requiredPositiveInt } from './config.ts';

const complete = {
  GAME: 'palworld',
  AGENT_PORT: '8300',
  PALWORLD_EXE_PATH: 'C:\\PalServer\\PalServer.exe',
  PALWORLD_REST_BASE_URL: 'http://127.0.0.1:8212',
  PALWORLD_ADMIN_PASSWORD: 'not-blank',
  STOP_TIMEOUT_MS: '30000',
} satisfies NodeJS.ProcessEnv;

const satisfactory = {
  GAME: 'satisfactory',
  AGENT_PORT: '8301',
  SATISFACTORY_API_BASE_URL: 'https://127.0.0.1:7777/api/v1',
  SATISFACTORY_ADMIN_PASSWORD: 'not-blank',
  SATISFACTORY_SESSION_NAME: 'Reveille-M0',
  STOP_TIMEOUT_MS: '30000',
} satisfies NodeJS.ProcessEnv;

test('a complete Palworld environment loads', () => {
  const config = loadConfig({ ...complete });
  assert.equal(config.game, 'palworld');
  assert.equal(config.port, 8300);
  assert.equal(config.stopTimeoutMs, 30000);
  if (config.game === 'palworld') {
    assert.equal(config.palworldAdminPassword, 'not-blank');
  }
});

test('every required Palworld variable fails loudly by name when missing', () => {
  for (const key of Object.keys(complete)) {
    const env = { ...complete };
    delete env[key as keyof typeof complete];
    assert.throws(() => loadConfig(env), new RegExp(key), `${key} was allowed to be missing`);
  }
});

test('GAME selects the adapter and fails loud on an unknown or blank value', () => {
  // A silent default game would control the WRONG server — so it must throw, naming GAME.
  assert.throws(() => loadConfig({ ...complete, GAME: 'minecraft' }), /GAME/);
  assert.throws(() => loadConfig({ ...complete, GAME: '   ' }), /GAME/);
});

test('a Satisfactory agent loads its own values and never consults Palworld’s', () => {
  const config = loadConfig({ ...satisfactory });
  assert.equal(config.game, 'satisfactory');
  assert.equal(config.port, 8301);
  if (config.game === 'satisfactory') {
    assert.equal(config.satisfactoryAdminPassword, 'not-blank');
    assert.equal(config.satisfactorySessionName, 'Reveille-M0');
  }
});

test('every required Satisfactory variable fails loudly by name when missing', () => {
  for (const key of Object.keys(satisfactory)) {
    const env = { ...satisfactory };
    delete env[key as keyof typeof satisfactory];
    assert.throws(() => loadConfig(env), new RegExp(key), `${key} was allowed to be missing`);
  }
});

test('a blank value is treated as missing, not as an empty default', () => {
  // The one that matters most: a blank AdminPassword is an open admin interface.
  assert.throws(
    () => loadConfig({ ...complete, PALWORLD_ADMIN_PASSWORD: '   ' }),
    /PALWORLD_ADMIN_PASSWORD/,
  );
  assert.throws(
    () => loadConfig({ ...satisfactory, SATISFACTORY_ADMIN_PASSWORD: '   ' }),
    /SATISFACTORY_ADMIN_PASSWORD/,
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

test('a trailing slash on the control-API base URL is normalised away', () => {
  const pal = loadConfig({ ...complete, PALWORLD_REST_BASE_URL: 'http://127.0.0.1:8212///' });
  if (pal.game === 'palworld') assert.equal(pal.palworldRestBaseUrl, 'http://127.0.0.1:8212');

  const sat = loadConfig({ ...satisfactory, SATISFACTORY_API_BASE_URL: 'https://127.0.0.1:7777/api/v1//' });
  if (sat.game === 'satisfactory') assert.equal(sat.satisfactoryApiBaseUrl, 'https://127.0.0.1:7777/api/v1');
});

test('required/requiredPositiveInt name the variable in the error', () => {
  assert.throws(() => required('NOPE', {}), /NOPE/);
  assert.throws(() => requiredPositiveInt('ALSO_NOPE', { ALSO_NOPE: 'x' }), /ALSO_NOPE/);
});
