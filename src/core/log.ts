// The debug log (opt in, Settings): one line per event, kept on the device in two parts. When the
// current part is full it becomes the old one and the part before that is dropped, so the log
// never holds more than two parts and always the newest events. Pure: io/log.ts stores it.

/** Characters per part; two parts at most, about 512 KB in all. */
export const LOG_PART_CHARS = 256 * 1024;
/** One line is cut here, so a huge value never pushes a whole part out. */
export const LOG_LINE_CHARS = 4000;

export interface LogParts {
  /** The part before the current one (older events). */
  old: string;
  cur: string;
}

export const emptyLog = (): LogParts => ({ old: '', cur: '' });

/** Keys whose values never go into the log, at any depth. */
const SECRET = /^(key|syncKey|secret|token|password|ciphertext|blob)$/i;

/** A value for the log: secrets out, long strings and lists shortened, cycles cut. */
export function scrub(v: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof v === 'string') return v.length > 300 ? `${v.slice(0, 300)}…(${v.length})` : v;
  if (typeof v !== 'object' || v === null) return v;
  if (v instanceof Error)
    return { error: v.name, message: v.message, stack: v.stack?.slice(0, 800) };
  if (seen.has(v) || depth > 5) return '…';
  seen.add(v);
  if (Array.isArray(v)) {
    const out = v.slice(0, 40).map((x) => scrub(x, depth + 1, seen));
    return v.length > 40 ? [...out, `…+${v.length - 40}`] : out;
  }
  return Object.fromEntries(
    Object.entries(v).map(([k, x]) => [k, SECRET.test(k) ? '(hidden)' : scrub(x, depth + 1, seen)]),
  );
}

/** `2026-11-02T09:01:02.345Z plan.done {"ms":812}`: one line, newline-free. */
export function logLine(at: number, event: string, data?: unknown): string {
  let text = `${new Date(at).toISOString()} ${event}`;
  if (data !== undefined) {
    let json: string;
    try {
      json = JSON.stringify(scrub(data));
    } catch {
      json = '"(unserialisable)"';
    }
    text += ` ${json}`;
  }
  text = text.replace(/[\r\n]+/g, ' ');
  return `${text.length > LOG_LINE_CHARS ? `${text.slice(0, LOG_LINE_CHARS)}…` : text}\n`;
}

/** Adds lines; a full current part becomes the old one (the one before it goes). */
export function appendLog(log: LogParts, lines: string[], max = LOG_PART_CHARS): LogParts {
  let { old, cur } = log;
  for (const line of lines) {
    if (cur.length + line.length > max && cur) {
      old = cur;
      cur = '';
    }
    cur += line;
  }
  return { old, cur };
}

/** The whole log, oldest first. */
export const logText = (log: LogParts) => log.old + log.cur;

export const logSize = (log: LogParts) => log.old.length + log.cur.length;

/** The part of an address worth logging: the screen, never a key or a trip's data. */
export function screenOf(hash: string): string {
  const path = hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  const [first = '', second, third] = path.split('/');
  if (!first) return '/';
  // Trip ids are local and help follow one trip; links and keys carry data or secrets.
  if (first === 'trip' && second) return `/trip/${second.slice(0, 40)}${third ? `/${third}` : ''}`;
  return `/${first}${second ? '/…' : ''}`;
}
