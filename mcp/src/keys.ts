// API keys: one per client, each revoked on its own. A key is `vk_<id>_<secret>`; the server keeps
// only its id, a label and the SHA-256 of the whole key, in a JSON file read again when it changes.
// The id says which client called (logs carry it, never the key); the hash is compared in constant
// time. `node server.mjs key create|list|revoke` is the routine (mcp/README.md).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';

export interface KeyEntry {
  id: string;
  label: string;
  /** SHA-256 of the whole key, hex. */
  hash: string;
  created: string;
}

/** The id of the key a token is, or null. */
export type KeyCheck = (token: string) => string | null;

const FORM = /^vk_([0-9a-f]{8})_([A-Za-z0-9_-]{43})$/;
const LABEL = /^[\w .-]{1,40}$/;
/** What `MCP_SECRET` is called while it still works. */
export const LEGACY = 'legacy';

const sha = (s: string) => createHash('sha256').update(s).digest();

export function newKey(
  label: string,
  taken: readonly KeyEntry[],
  now = new Date(),
  rand: (n: number) => Buffer = randomBytes,
): { key: string; entry: KeyEntry } {
  if (!LABEL.test(label)) throw new Error('label: 1 to 40 letters, digits, spaces, . _ -');
  if (taken.some((e) => e.label === label)) throw new Error(`a key named ${label} exists`);
  let id: string;
  do id = rand(4).toString('hex');
  while (taken.some((e) => e.id === id));
  const key = `vk_${id}_${rand(32).toString('base64url')}`;
  return { key, entry: { id, label, hash: sha(key).toString('hex'), created: now.toISOString() } };
}

export function checkWith(entries: readonly KeyEntry[], legacy?: string): KeyCheck {
  const old = legacy ? sha(legacy) : null;
  return (token) => {
    const m = FORM.exec(token);
    if (m) {
      const e = entries.find((x) => x.id === m[1]);
      const want = e && Buffer.from(e.hash, 'hex');
      return e && want!.length === 32 && timingSafeEqual(sha(token), want!) ? e.id : null;
    }
    return old && timingSafeEqual(sha(token), old) ? LEGACY : null;
  };
}

export function readKeys(path: string): KeyEntry[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
  const data = JSON.parse(text) as { keys?: unknown };
  if (!Array.isArray(data.keys)) throw new Error(`${path}: no keys list`);
  return data.keys.filter(
    (k): k is KeyEntry =>
      typeof k === 'object' &&
      k !== null &&
      typeof (k as KeyEntry).id === 'string' &&
      typeof (k as KeyEntry).label === 'string' &&
      /^[0-9a-f]{64}$/.test(String((k as KeyEntry).hash)),
  );
}

function writeKeys(path: string, keys: readonly KeyEntry[]) {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ keys }, null, 2) + '\n', { mode: 0o600 });
  renameSync(tmp, path);
}

/**
 * The keys in `path`, read again whenever the file's time or size changes, so a key created or
 * revoked counts at the next request without a restart. A file that cannot be read keeps the keys
 * read last (never none because of a half-written file); `onError` is told.
 */
export function fileKeys(path: string, legacy?: string, onError?: (e: unknown) => void): KeyCheck {
  let seen = '';
  let check = checkWith([], legacy);
  return (token) => {
    let stamp = 'none';
    try {
      const s = statSync(path);
      stamp = `${s.mtimeMs}:${s.size}`;
    } catch {
      // gone: no keys but the legacy secret
    }
    if (stamp !== seen) {
      try {
        check = checkWith(stamp === 'none' ? [] : readKeys(path), legacy);
        seen = stamp;
      } catch (e) {
        onError?.(e);
      }
    }
    return check(token);
  };
}

/** `key create <label>`, `key list`, `key revoke <id>`. Returns the exit code. */
export function keyCommand(
  args: readonly string[],
  path: string,
  out: (line: string) => void,
  now = new Date(),
): number {
  const [verb, arg] = args;
  const keys = readKeys(path);
  if (verb === 'create' && arg) {
    const { key, entry } = newKey(arg, keys, now);
    writeKeys(path, [...keys, entry]);
    out(`Created ${entry.id} (${entry.label}). The key, shown only now:`);
    out(key);
    out('Send it as "Authorization: Bearer <key>" to /mcp.');
    return 0;
  }
  if (verb === 'list' && !arg) {
    if (!keys.length) out('No keys.');
    for (const k of keys) out(`${k.id}  ${k.created.slice(0, 10)}  ${k.label}`);
    return 0;
  }
  if (verb === 'revoke' && arg) {
    const left = keys.filter((k) => k.id !== arg && k.label !== arg);
    if (left.length === keys.length) {
      out(`No key ${arg}.`);
      return 1;
    }
    writeKeys(path, left);
    out(`Revoked ${arg}.`);
    return 0;
  }
  out('Usage: key create <label> | key list | key revoke <id or label>');
  return 2;
}
