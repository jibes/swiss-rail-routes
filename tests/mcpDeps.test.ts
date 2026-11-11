// The VPS's MCP bundle installs mcp/package.json as it is: its versions must be the ones the app
// is built and tested with (review of 11 Nov 2026: nothing kept them in step).
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const json = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>;

it('mcp/package.json pins the versions installed for the app', () => {
  const deps = json('mcp/package.json').dependencies as Record<string, string>;
  for (const [name, version] of Object.entries(deps))
    expect(version, name).toBe(json(`node_modules/${name}/package.json`).version);
});
