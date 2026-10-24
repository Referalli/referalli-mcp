import { describe, expect, it } from 'vitest';
import { TOOLS } from '../src/index.js';

const partner = { referralLink: 'https://go.acme.test/go/tok/ana', pendingMinor: 4100, approvedMinor: 2000, paidMinor: 900, currency: 'usd', nextPayoutAt: '2026-11-01' };

function api(body: unknown) {
  const urls: string[] = [];
  const fetchFn = (async (url: any, init: any) => {
    urls.push(`${init.method} ${url}`);
    return { ok: true, json: async () => body } as Response;
  }) as typeof fetch;
  return { urls, fetchFn };
}

describe('partner self-service tools', () => {
  it('are read-only and key on the partner externalRef', async () => {
    const a = api({ partner, customer: null, links: {} });
    const ctx = { baseUrl: 'http://api', apiKey: 'rk_test', fetchFn: a.fetchFn };
    const link = await TOOLS.find((t) => t.name === 'my_referral_link')!.run(ctx, { partnerExternalRef: 'user 42' });
    expect(link).toEqual({ found: true, referralLink: partner.referralLink });
    expect(a.urls[0]).toBe('GET http://api/v1/support/context?partnerExternalRef=user%2042');
    expect(await TOOLS.find((t) => t.name === 'my_balance')!.run(ctx, { partnerExternalRef: 'u' })).toEqual({
      found: true, pendingMinor: 4100, approvedMinor: 2000, paidMinor: 900, currency: 'usd',
    });
    expect(await TOOLS.find((t) => t.name === 'my_next_payout')!.run(ctx, { partnerExternalRef: 'u' })).toEqual({
      found: true, nextPayoutAt: '2026-11-01', approvedMinor: 2000, currency: 'usd',
    });
    for (const n of ['my_referral_link', 'my_balance', 'my_next_payout']) expect(TOOLS.find((t) => t.name === n)!.write).not.toBe(true);
  });

  it('answers found: false for an unknown partner and refuses a missing ref', async () => {
    const a = api({ partner: null, customer: null, links: {} });
    const ctx = { baseUrl: 'http://api', apiKey: 'rk_test', fetchFn: a.fetchFn };
    const tool = TOOLS.find((t) => t.name === 'my_balance')!;
    expect(await tool.run(ctx, { partnerExternalRef: 'nobody' })).toEqual({ found: false });
    await expect(tool.run(ctx, {})).rejects.toThrow('partnerExternalRef');
  });
});
