import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderReply, plainText } from './render.ts';
import { describeStart, describeStatus, describePause, type Reply } from '../commands.ts';
import type { AgentResult } from '../agent-client.ts';
import type { AgentResponse } from '@reveille/contract';

const reached = (status: number, body: AgentResponse): AgentResult => ({ reached: true, status, body });

test('the member-visible sentence is rendered WORD FOR WORD (FR-021)', () => {
  const reply = describeStart(reached(202, { state: 'starting' }));
  const out = renderReply(reply, { serverName: 'satisfactory' });

  // Every word of the reply, in order, on the first line — the same sentence Discord shows.
  const first = out.split('\n')[0] ?? '';
  assert.ok(first.includes(plainText(reply.text)), 'the reply text must survive rendering intact');
  assert.match(first, /^Satisfactory — /, 'the target names itself, as the embed title does');
});

test('emphasis markers are dropped but no WORD changes', () => {
  const reply: Reply = { tone: 'ok', text: '**Palworld** — running at `127.0.0.1:8211`' };
  const out = renderReply(reply);

  assert.equal(out, 'Palworld — running at 127.0.0.1:8211');
  // The property that matters: stripping is presentation, never content.
  const words = (s: string) => s.replace(/[*`]/g, '').split(/\s+/).filter(Boolean);
  assert.deepEqual(words(out), words(reply.text), 'rendering must not add or remove a word');
});

test('the operator half appears here, and only here (007 built it with nowhere to show it)', () => {
  const reply = describePause({ reached: false, reason: 'ECONNREFUSED 127.0.0.1:8302' });
  assert.ok(reply.diagnostic !== undefined, 'this branch must carry an operator diagnostic');

  const out = renderReply(reply, { serverName: 'vlc', agentUrl: 'http://127.0.0.1:8302' });

  assert.match(out, /ECONNREFUSED/, 'the diagnostic is shown to the operator');
  assert.match(out, /http:\/\/127\.0\.0\.1:8302/, 'and which agent answered');
  assert.equal(
    out.split('\n')[0]?.includes('ECONNREFUSED'),
    false,
    'but never on the member-visible line — that is what 007 separated',
  );
});

test('a clean success stays clean — no empty diagnostic or via lines', () => {
  const out = renderReply({ tone: 'ok', text: 'Paused.' });
  assert.equal(out, 'Paused.', 'nothing to report means nothing printed');
  assert.equal(out.includes('diag:'), false);
  assert.equal(out.includes('via:'), false);
});

test('a multi-line fold keeps its heading off the sentence', () => {
  const reply = describeStatus([
    { name: 'palworld', result: reached(200, { state: 'running' }) },
    { name: 'vlc', result: reached(200, { state: 'playing' }) },
  ]);
  const out = renderReply(reply);

  assert.match(out, /Palworld/);
  assert.match(out, /VLC/, 'the acronym stays spelled correctly through rendering');
  assert.equal(out.split('\n').length >= 2, true, 'each target on its own line');
});

test('the footnote is shown, and is not mistaken for the substance', () => {
  const reply = describeStart(reached(202, { state: 'starting' }));
  const out = renderReply(reply, { serverName: 'palworld' });
  if (reply.footnote === undefined) return;
  const lines = out.split('\n');
  assert.equal(lines[0]?.includes(reply.footnote), false, 'the footnote is not part of the sentence');
  assert.ok(out.includes('note:'), 'but it is still shown to the operator');
});

// ── The secrets guard (research.md §9) ────────────────────────────────────────
// The console loads `orchestrator/.env` for TENANTS, so DISCORD_BOT_TOKEN is in its
// process environment — and this repository is public. A debug dump in an operator tool is
// the most plausible route from that env var to a screenshot.

test('no console module reads or prints the environment', () => {
  const dir = new URL('./', import.meta.url);
  const files = readdirSync(fileURLToPath(dir)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  assert.ok(files.length > 0, 'the guard must actually scan something');

  for (const file of files) {
    const src = readFileSync(fileURLToPath(new URL(file, dir)), 'utf8');
    const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

    // Printing the whole environment, in any of its usual spellings.
    assert.equal(
      /(write|log|error|info|debug)\s*\([^)]*process\.env(?!\.[A-Z_]*\s*(!==|===|==|!=))/.test(code),
      false,
      `${file} must never write process.env to any output stream`,
    );
    assert.equal(
      /JSON\.stringify\s*\(\s*process\.env/.test(code),
      false,
      `${file} must never serialise the environment`,
    );
    assert.equal(
      /DISCORD_BOT_TOKEN|DISCORD_APPLICATION_ID/.test(code),
      false,
      `${file} must not touch the bot credentials at all — it has no use for them`,
    );
  }
});

test('render.ts does not read the environment at all', () => {
  const src = readFileSync(fileURLToPath(new URL('./render.ts', import.meta.url)), 'utf8');
  const code = src.replace(/\/\*\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/process\.env/.test(code), false, 'the renderer has no business with configuration');
});
