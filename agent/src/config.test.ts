import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, required, requiredPositiveInt } from './config.ts';

const palworld = {
  TARGET: 'palworld',
  AGENT_PORT: '8300',
  PALWORLD_EXE_PATH: 'C:\\PalServer\\PalServer.exe',
  PALWORLD_REST_BASE_URL: 'http://127.0.0.1:8212',
  PALWORLD_ADMIN_PASSWORD: 'not-blank',
  STOP_TIMEOUT_MS: '30000',
} satisfies NodeJS.ProcessEnv;

const satisfactory = {
  TARGET: 'satisfactory',
  AGENT_PORT: '8301',
  SATISFACTORY_EXE_PATH: 'C:\\SatisfactoryDedicatedServer\\FactoryServer.exe',
  SATISFACTORY_API_BASE_URL: 'https://127.0.0.1:7777/api/v1',
  SATISFACTORY_ADMIN_PASSWORD: 'not-blank',
  SATISFACTORY_SESSION_NAME: 'Reveille-M0',
  STOP_TIMEOUT_MS: '30000',
} satisfies NodeJS.ProcessEnv;

const vlc = {
  TARGET: 'vlc',
  AGENT_PORT: '8302',
  VLC_BASE_URL: 'http://127.0.0.1:8080',
  VLC_PASSWORD: 'not-blank',
} satisfies NodeJS.ProcessEnv;

test('a complete Palworld environment loads', () => {
  const config = loadConfig({ ...palworld });
  assert.equal(config.target, 'palworld');
  assert.equal(config.port, 8300);
  if (config.target === 'palworld') {
    assert.equal(config.palworldAdminPassword, 'not-blank');
    assert.equal(config.stopTimeoutMs, 30000);
  }
});

test('every required Palworld variable fails loudly by name when missing', () => {
  for (const key of Object.keys(palworld)) {
    const env = { ...palworld };
    delete env[key as keyof typeof palworld];
    assert.throws(() => loadConfig(env), new RegExp(key), `${key} was allowed to be missing`);
  }
});

test('TARGET selects the adapter and fails loud on an unknown or blank value', () => {
  // A silent default target would control the WRONG thing — so it must throw, naming TARGET.
  assert.throws(() => loadConfig({ ...palworld, TARGET: 'minecraft' }), /TARGET/);
  assert.throws(() => loadConfig({ ...palworld, TARGET: '   ' }), /TARGET/);
});

test('a Satisfactory agent loads its own values and never consults Palworld’s', () => {
  const config = loadConfig({ ...satisfactory });
  assert.equal(config.target, 'satisfactory');
  assert.equal(config.port, 8301);
  if (config.target === 'satisfactory') {
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

test('a VLC (media) agent loads its own values — no game or stop-bound needed', () => {
  const config = loadConfig({ ...vlc });
  assert.equal(config.target, 'vlc');
  assert.equal(config.port, 8302);
  if (config.target === 'vlc') {
    assert.equal(config.vlcBaseUrl, 'http://127.0.0.1:8080');
    assert.equal(config.vlcPassword, 'not-blank');
  }
});

test('every required VLC variable fails loudly by name when missing', () => {
  for (const key of Object.keys(vlc)) {
    const env = { ...vlc };
    delete env[key as keyof typeof vlc];
    assert.throws(() => loadConfig(env), new RegExp(key), `${key} was allowed to be missing`);
  }
});

test('a media agent does NOT require a stop bound (it never stops a process)', () => {
  // STOP_TIMEOUT_MS is game-only; a VLC agent must load without it.
  assert.doesNotThrow(() => loadConfig({ ...vlc }));
});

test('a blank value is treated as missing, not as an empty default', () => {
  assert.throws(
    () => loadConfig({ ...palworld, PALWORLD_ADMIN_PASSWORD: '   ' }),
    /PALWORLD_ADMIN_PASSWORD/,
  );
  assert.throws(() => loadConfig({ ...vlc, VLC_PASSWORD: '   ' }), /VLC_PASSWORD/);
});

test('the stop bound must be a positive integer (FR-007)', () => {
  for (const bad of ['0', '-1', 'soon', '1.5', '']) {
    assert.throws(
      () => loadConfig({ ...palworld, STOP_TIMEOUT_MS: bad }),
      /STOP_TIMEOUT_MS/,
      `STOP_TIMEOUT_MS accepted ${JSON.stringify(bad)}`,
    );
  }
});

test('a trailing slash on a control-API base URL is normalised away', () => {
  const pal = loadConfig({ ...palworld, PALWORLD_REST_BASE_URL: 'http://127.0.0.1:8212///' });
  if (pal.target === 'palworld') assert.equal(pal.palworldRestBaseUrl, 'http://127.0.0.1:8212');

  const v = loadConfig({ ...vlc, VLC_BASE_URL: 'http://127.0.0.1:8080//' });
  if (v.target === 'vlc') assert.equal(v.vlcBaseUrl, 'http://127.0.0.1:8080');
});

test('required/requiredPositiveInt name the variable in the error', () => {
  assert.throws(() => required('NOPE', {}), /NOPE/);
  assert.throws(() => requiredPositiveInt('ALSO_NOPE', { ALSO_NOPE: 'x' }), /ALSO_NOPE/);
});
