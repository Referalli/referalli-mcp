import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/index.js';

describe('mcp tools', () => {
  it('calls the public api with the key and returns parsed json', async () => {
    const seen: string[] = [];
    const fetchFn = (async (url: any, init: any) => {
      seen.push(`${url} ${init.headers.authorization}`);
      return { ok: true, json: async () => [{ id: 'prg_1' }] } as Response;
    }) as typeof fetch;
    const tool = TOOLS.find((t) => t.name === 'list_programs')!;
    const result = await tool.run({ baseUrl: 'http://api', apiKey: 'rk_test', fetchFn });
    expect(result).toEqual([{ id: 'prg_1' }]);
    expect(seen[0]).toBe('http://api/v1/programs Bearer rk_test');
  });

  it('surfaces api errors', async () => {
    const fetchFn = (async () => ({ ok: false, status: 401 }) as Response) as typeof fetch;
    const tool = TOOLS.find((t) => t.name === 'program_overview')!;
    await expect(tool.run({ baseUrl: 'http://api', apiKey: 'bad', fetchFn })).rejects.toThrow('401');
  });
});
