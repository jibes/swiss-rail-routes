import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkWith, fileKeys, keyCommand, LEGACY, newKey, readKeys } from '../mcp/src/keys';

const dir = () => mkdtempSync(join(tmpdir(), 'mcp-keys-'));
const created = (path: string, label: string) => {
  const lines: string[] = [];
  expect(keyCommand(['create', label], path, (l) => lines.push(l))).toBe(0);
  return lines[1]!;
};

describe('API keys', () => {
  it('a key is vk_<id>_<secret>; only its hash is kept', () => {
    const { key, entry } = newKey('claude', []);
    expect(key).toMatch(/^vk_[0-9a-f]{8}_[A-Za-z0-9_-]{43}$/);
    expect(key.slice(3, 11)).toBe(entry.id);
    expect(JSON.stringify(entry)).not.toContain(key.slice(12));
    expect(checkWith([entry])(key)).toBe(entry.id);
  });

  it('refuses a changed key, another id, a bad label, a label twice', () => {
    const { key, entry } = newKey('a', []);
    const check = checkWith([entry]);
    expect(check(key.slice(0, -1) + (key.endsWith('A') ? 'B' : 'A'))).toBeNull();
    expect(check(key.replace(entry.id, '00000000'))).toBeNull();
    expect(check('')).toBeNull();
    expect(() => newKey('', [])).toThrow();
    expect(() => newKey('x/y', [])).toThrow();
    expect(() => newKey('a', [entry])).toThrow(/exists/);
  });

  it('MCP_SECRET still works, as the key called legacy', () => {
    const old = 'an-old-secret-that-is-long-enough-to-pass';
    expect(checkWith([], old)(old)).toBe(LEGACY);
    expect(checkWith([])(old)).toBeNull();
    expect(checkWith([], old)(old + 'x')).toBeNull();
  });

  it('create, list and revoke; a change counts at the next request', () => {
    const path = join(dir(), 'keys.json');
    const check = fileKeys(path);
    const a = created(path, 'claude');
    const b = created(path, 'tester');
    expect(check(a)).toBe(a.slice(3, 11));
    expect(check(b)).toBe(b.slice(3, 11));
    const listed: string[] = [];
    keyCommand(['list'], path, (l) => listed.push(l));
    expect(listed.join('\n')).toContain('claude');
    expect(listed.join('\n')).not.toContain(a.slice(12));
    expect(readFileSync(path, 'utf8')).not.toContain(a.slice(12));
    expect(keyCommand(['revoke', 'tester'], path, () => {})).toBe(0);
    expect(check(b)).toBeNull();
    expect(check(a)).not.toBeNull();
    expect(keyCommand(['revoke', a.slice(3, 11)], path, () => {})).toBe(0);
    expect(check(a)).toBeNull();
    expect(keyCommand(['revoke', 'nobody'], path, () => {})).toBe(1);
    expect(keyCommand(['nonsense'], path, () => {})).toBe(2);
  });

  it('a file that cannot be read keeps the keys read last', () => {
    const path = join(dir(), 'keys.json');
    const a = created(path, 'claude');
    const errors: unknown[] = [];
    const check = fileKeys(path, undefined, (e) => errors.push(e));
    expect(check(a)).not.toBeNull();
    writeFileSync(path, '{"keys": [');
    expect(check(a)).not.toBeNull();
    expect(errors).toHaveLength(1);
  });

  it('no file is no keys', () => {
    const path = join(dir(), 'none.json');
    expect(readKeys(path)).toEqual([]);
    expect(fileKeys(path)('vk_00000000_' + 'a'.repeat(43))).toBeNull();
  });
});
