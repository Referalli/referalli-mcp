import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BASE_URL, VERSION } from '../src/index.js';

describe('@referalli/mcp package', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    name: string;
    version: string;
    private?: boolean;
    bin: Record<string, string>;
  };

  it('is publishable, npx-runnable and versioned in step', () => {
    expect(pkg.name).toBe('@referalli/mcp');
    expect(pkg.private).toBeUndefined();
    expect(pkg.bin).toEqual({ 'referalli-mcp': './dist/bin/referalli-mcp.js' });
    expect(VERSION).toBe(pkg.version);
  });

  it('defaults to the production API', () => {
    expect(DEFAULT_BASE_URL).toBe('https://referalli.com');
  });
});
