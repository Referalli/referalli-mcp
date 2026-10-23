import { describe, expect, it } from 'vitest';
import { ConfirmationStore, TOOLS, type ToolContext } from '../src/index.js';

/** Write tools: a preview first, then a confirmed call with a one-time token. */
function fakeApi(handler: (method: string, url: string, body: unknown) => { status?: number; json: unknown }) {
  const calls: Array<{ method: string; url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: String(init.method), url, body, headers: init.headers as Record<string, string> });
    const r = handler(String(init.method), url, body);
    const status = r.status ?? 200;
    return { ok: status < 400, status, json: async () => r.json } as Response;
  }) as typeof fetch;
  return { fetchFn, calls };
}

const tool = (name: string) => TOOLS.find((t) => t.name === name)!;

describe('mcp write tools', () => {
  let now = Date.parse('2026-10-22T12:00:00Z');
  const ctxWith = (fetchFn: typeof fetch): ToolContext => ({
    baseUrl: 'http://api',
    apiKey: 'rk_k',
    fetchFn,
    confirmations: new ConfirmationStore(() => now),
  });

  it('the first call only previews; the confirmed call writes once', async () => {
    const api = fakeApi((m) =>
      m === 'GET' ? { json: { id: 'ref_1', status: 'pending_review' } } : { json: { id: 'ref_1', status: 'active' } },
    );
    const ctx = ctxWith(api.fetchFn);
    const preview = (await tool('approve_referral').run(ctx, { referralId: 'ref_1' })) as {
      preview: { action: string; request: { method: string; path: string }; current: unknown };
      confirmToken: string;
    };
    expect(preview.preview.request).toEqual({ method: 'POST', path: '/v1/referrals/ref_1/approve' });
    expect(preview.preview.current).toEqual({ id: 'ref_1', status: 'pending_review' });
    expect(api.calls.every((c) => c.method === 'GET')).toBe(true); // nothing written yet

    const done = await tool('approve_referral').run(ctx, { referralId: 'ref_1', confirm: true, confirmToken: preview.confirmToken });
    expect(done).toEqual({ id: 'ref_1', status: 'active' });
    const write = api.calls.find((c) => c.method === 'POST')!;
    expect(write.url).toBe('http://api/v1/referrals/ref_1/approve');
    expect(write.headers['idempotency-key']).toBe(preview.confirmToken);
    expect(write.headers.authorization).toBe('Bearer rk_k');

    // The token is spent.
    await expect(
      tool('approve_referral').run(ctx, { referralId: 'ref_1', confirm: true, confirmToken: preview.confirmToken }),
    ).rejects.toThrow('confirmation refused');
  });

  it('a token is bound to its tool and its exact arguments', async () => {
    const api = fakeApi(() => ({ json: { ok: true } }));
    const ctx = ctxWith(api.fetchFn);
    const p = (await tool('void_referral').run(ctx, { referralId: 'ref_1' })) as { confirmToken: string };
    await expect(
      tool('void_referral').run(ctx, { referralId: 'ref_2', confirm: true, confirmToken: p.confirmToken }),
    ).rejects.toThrow('confirmation refused');
    const q = (await tool('void_referral').run(ctx, { referralId: 'ref_1' })) as { confirmToken: string };
    await expect(
      tool('approve_referral').run(ctx, { referralId: 'ref_1', confirm: true, confirmToken: q.confirmToken }),
    ).rejects.toThrow('confirmation refused');
    expect(api.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('a token expires after 5 minutes, and confirm without a token is refused', async () => {
    const api = fakeApi(() => ({ json: { ok: true } }));
    const ctx = ctxWith(api.fetchFn);
    const p = (await tool('approve_due_commissions').run(ctx, {})) as { confirmToken: string; expiresAt: string };
    expect(Date.parse(p.expiresAt) - now).toBe(5 * 60 * 1000);
    now += 5 * 60 * 1000 + 1;
    await expect(tool('approve_due_commissions').run(ctx, { confirm: true, confirmToken: p.confirmToken })).rejects.toThrow(
      'confirmation refused',
    );
    await expect(tool('approve_due_commissions').run(ctx, { confirm: true })).rejects.toThrow('confirmation refused');
    expect(api.calls).toHaveLength(0);
  });

  it("surfaces the API's refusal, e.g. a key without the scope", async () => {
    const api = fakeApi(() => ({ status: 403, json: { error: { message: 'this API key lacks the payouts:write scope' } } }));
    const ctx = ctxWith(api.fetchFn);
    const p = (await tool('create_payout_run').run(ctx, {})) as { confirmToken: string };
    await expect(tool('create_payout_run').run(ctx, { confirm: true, confirmToken: p.confirmToken })).rejects.toThrow(
      'payouts:write scope',
    );
  });

  it('every write tool previews without writing and builds the documented request', async () => {
    const api = fakeApi(() => ({ json: {} }));
    const ctx = ctxWith(api.fetchFn);
    const args: Record<string, Record<string, unknown>> = {
      create_partner: { email: 'p@x.io', displayName: 'P' },
      create_link: { programId: 'prg_1', partnerId: 'ptr_1', destinationUrl: 'https://x.io/' },
      create_coupon: { programId: 'prg_1', partnerId: 'ptr_1', code: 'SAVE10' },
      pause_referral: { referralId: 'ref_1' },
      resume_referral: { referralId: 'ref_1' },
      settle_commission: { commissionId: 'cme_1', reference: 'tx_1' },
    };
    const expected: Record<string, unknown> = {
      create_partner: { method: 'POST', path: '/v1/partners', body: { email: 'p@x.io', displayName: 'P' } },
      pause_referral: { method: 'PATCH', path: '/v1/referrals/ref_1', body: { status: 'paused' } },
      resume_referral: { method: 'PATCH', path: '/v1/referrals/ref_1', body: { status: 'active' } },
      settle_commission: {
        method: 'POST',
        path: '/v1/commissions/cme_1/settle',
        body: { method: 'store_credit', reference: 'tx_1' },
      },
    };
    const writes = TOOLS.filter((t) => t.write);
    expect(writes.map((t) => t.name).sort()).toEqual(
      [
        'approve_due_commissions',
        'approve_referral',
        'create_coupon',
        'create_link',
        'create_partner',
        'create_payout_run',
        'pause_referral',
        'resume_referral',
        'settle_commission',
        'void_referral',
      ].sort(),
    );
    for (const [name, a] of Object.entries(args)) {
      const r = (await tool(name).run(ctx, a)) as { preview: { request: unknown } };
      if (expected[name]) expect(r.preview.request).toEqual(expected[name]);
    }
    expect(api.calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
});
