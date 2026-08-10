/**
 * How a reply reads in a terminal (008 FR-021, `contracts/console-surface.md` §4).
 *
 * Two audiences in one output. The first line is **the sentence a Discord member would
 * read** — the same words, from the same `describeX` function, so the two surfaces cannot
 * describe an outcome differently. Everything under it is the operator's: the footnote, the
 * diagnostic 007 built and deliberately never rendered, and which agent answered.
 *
 * `Reply.diagnostic` is the reason this feature is cheap. 007 split every reply into
 * member-visible text and operator-only detail, then had nowhere to show the second half —
 * `toEmbed` reads only `text` and `footnote`. This is the surface it was built for.
 *
 * **This module never reads the environment.** The console loads `orchestrator/.env` to get
 * `TENANTS`, so `DISCORD_BOT_TOKEN` is in its process environment and the repository is
 * public. A debug dump in an operator tool is the most plausible way that token ever
 * reaches a screenshot, so the rule is enforced by a test rather than by care.
 */
import { titleCase, type Reply } from '../commands.ts';

/** What the console knows about a reply beyond the reply itself. */
export interface RenderContext {
  /** The target acted on, when the command named one. Mirrors the embed's title. */
  readonly serverName?: string | undefined;
  /** The agent that answered. Operator detail — an agent's URL is its identity. */
  readonly agentUrl?: string | undefined;
}

/**
 * Drop Discord's emphasis markers.
 *
 * Discord renders `**Palworld**` as bold; a terminal renders it as four asterisks and a
 * word. Removing them is the same act Discord performs — presenting the sentence for its
 * medium — and it changes no word, which `render.test.ts` pins. Only the two markers the
 * reply functions actually use are touched; nothing else is interpreted.
 */
export function plainText(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1');
}

/** An operator line, indented so the member-visible sentence stays the thing you read first. */
function detail(label: string, value: string): string {
  return `  ${label.padEnd(5)} ${value}`;
}

/**
 * Render one reply for the terminal.
 *
 * Returns the text rather than printing it, so every branch is testable without capturing
 * stdout — the same reason `describeX` is pure.
 */
export function renderReply(reply: Reply, context: RenderContext = {}): string {
  const body = plainText(reply.text);
  const name = context.serverName === undefined ? undefined : titleCase(context.serverName);

  const lines: string[] = [];
  // A multi-line reply (the status fold) gets its heading on its own line; a one-liner reads
  // better inline. Either way the sentence itself is never altered.
  if (name !== undefined && body.includes('\n')) {
    lines.push(name, body);
  } else if (name !== undefined) {
    lines.push(`${name} — ${body}`);
  } else {
    lines.push(body);
  }

  if (reply.footnote !== undefined) lines.push(detail('note:', plainText(reply.footnote)));
  // The operator half. Present only when the reply carried one, so a clean success stays clean.
  if (reply.diagnostic !== undefined) lines.push(detail('diag:', reply.diagnostic));
  if (context.agentUrl !== undefined) lines.push(detail('via:', context.agentUrl));

  return lines.join('\n');
}

/** Write a rendered reply out. The only impure step, kept to one line so it cannot grow logic. */
export function printReply(reply: Reply, context: RenderContext = {}): void {
  process.stdout.write(`${renderReply(reply, context)}\n`);
}

/**
 * A usage failure — misuse of the console itself, not an outcome the system reported.
 *
 * Goes to stderr because it is not the answer to a question; a script redirecting stdout
 * should get nothing rather than something that looks like a result.
 */
export function printUsage(message: string): void {
  process.stderr.write(`${plainText(message)}\n`);
}
