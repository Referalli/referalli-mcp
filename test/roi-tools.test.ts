import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { TOOLS } from '../src/index.js';

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;
const schema = (name: string) => z.object(tool(name).input);

function fake() {
  const urls: string[] = [];
  const fetchFn = (async (url: string) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
  }) as typeof fetch;
  return { urls, ctx: { baseUrl: 'http://api', apiKey: 'rk_k', fetchFn } };
}

describe('mcp roi tools', () => {
  it('are read tools that explain cash vs credit and the null profit', () => {
    for (const name of ['roi_summary', 'roi_trace', 'roi_patterns']) {
      expect(tool(name), name).toBeDefined();
      expect(tool(name).write).not.toBe(true);
    }
    const d = tool('roi_summary').description;
    expect(d).toMatch(/cash/i);
    expect(d).toMatch(/credit is not|not real money/i);
    expect(d).toMatch(/null/);
    expect(d).toMatch(/margin/i);
  });

  it('roi_summary passes its filters as a query string', async () => {
    const { urls, ctx } = fake();
    await tool('roi_summary').run(ctx, { from: '2026-10-01', to: '2026-10-08', programId: 'prg_1', partnerId: 'par_1', currency: 'eur' });
    const u = new URL(urls[0]!);
    expect(u.pathname).toBe('/v1/roi/summary');
    expect(Object.fromEntries(u.searchParams)).toEqual({ from: '2026-10-01', to: '2026-10-08', programId: 'prg_1', partnerId: 'par_1', currency: 'eur' });
    await tool('roi_summary').run(ctx, {});
    expect(urls[1]).toBe('http://api/v1/roi/summary');
  });

  it('roi_trace takes a customerRef or a partnerId, not neither or both', async () => {
    const s = schema('roi_trace');
    expect(s.safeParse({ customerRef: 'c' }).success).toBe(true);
    expect(s.safeParse({ partnerId: 'p' }).success).toBe(true);
    const { urls, ctx } = fake();
    await tool('roi_trace').run(ctx, { customerRef: 'cust/1 x' });
    await tool('roi_trace').run(ctx, { partnerId: 'par_9' });
    expect(urls).toEqual(['http://api/v1/roi/trace/cust%2F1%20x', 'http://api/v1/roi/partners/par_9/trace']);
    await expect(tool('roi_trace').run(ctx, {})).rejects.toThrow(/exactly one of customerRef or partnerId/);
    await expect(tool('roi_trace').run(ctx, { customerRef: 'c', partnerId: 'p' })).rejects.toThrow(/exactly one of customerRef or partnerId/);
  });

  it('roi_patterns accepts only the four patterns', async () => {
    const s = schema('roi_patterns');
    expect(s.safeParse({ pattern: 'credit_only' }).success).toBe(true);
    expect(s.safeParse({ pattern: 'churn_at_exhaustion' }).success).toBe(true);
    expect(s.safeParse({ pattern: 'nope' }).success).toBe(false);
    const { urls, ctx } = fake();
    await tool('roi_patterns').run(ctx, { pattern: 'negative_partner' });
    expect(urls[0]).toBe('http://api/v1/roi/patterns/negative_partner');
  });
});
