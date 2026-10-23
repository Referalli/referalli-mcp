import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Referalli MCP tools over the public API. Pure functions over an injected
 * fetch so they are testable without a server.
 *
 * Read tools answer directly. Write tools never act on the first call: they
 * return a preview of exactly what would happen plus a one-time confirmation
 * token, and only a second call with `confirm: true`, that token and the same
 * arguments (within 5 minutes) performs the change. The API key's scopes still
 * decide what is allowed; a refusal comes back as the API's error.
 */

export interface ToolContext {
  baseUrl: string;
  apiKey: string;
  fetchFn?: typeof fetch;
  /** Holds pending confirmations; one per server process. */
  confirmations?: ConfirmationStore;
}

const CONFIRM_TTL_MS = 5 * 60 * 1000;

/** Stable JSON: the same arguments always serialise the same way. */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(',')}}`
      : JSON.stringify(v);

/** One-time confirmation tokens, each bound to a tool and its exact arguments. */
export class ConfirmationStore {
  private pending = new Map<string, { tool: string; args: string; expiresAt: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  issue(tool: string, args: Record<string, unknown>): { token: string; expiresAt: string } {
    this.sweep();
    const token = `cfm_${randomBytes(12).toString('hex')}`;
    const expiresAt = this.now() + CONFIRM_TTL_MS;
    this.pending.set(token, { tool, args: stable(args), expiresAt });
    return { token, expiresAt: new Date(expiresAt).toISOString() };
  }

  /** Spend a token; false when it's unknown, expired, used, or for other arguments. */
  consume(tool: string, token: string | undefined, args: Record<string, unknown>): boolean {
    if (!token) return false;
    const entry = this.pending.get(token);
    if (!entry) return false;
    this.pending.delete(token); // one try: a mismatch burns it too
    return entry.tool === tool && entry.args === stable(args) && entry.expiresAt > this.now();
  }

  private sweep(): void {
    const now = this.now();
    for (const [t, e] of this.pending) if (e.expiresAt <= now) this.pending.delete(t);
  }
}

async function call(
  ctx: ToolContext,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<unknown> {
  const fetchFn = ctx.fetchFn ?? fetch;
  const res = await fetchFn(`${ctx.baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${ctx.apiKey}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const data = (await res.json()) as { error?: { message?: string } };
      detail = data?.error?.message ? `: ${data.error.message}` : '';
    } catch {
      /* no JSON body */
    }
    throw new Error(`referalli api ${method} ${path} -> ${res.status}${detail}`);
  }
  return res.json();
}

const get = (ctx: ToolContext, path: string) => call(ctx, 'GET', path);

type Args = Record<string, unknown>;

interface ReadTool {
  name: string;
  description: string;
  input: z.ZodRawShape;
  write?: false;
  run(ctx: ToolContext, args?: Args): Promise<unknown>;
}

/** A write: what it would send, and (optionally) what it would change, for the preview. */
interface WriteSpec {
  name: string;
  description: string;
  input: z.ZodRawShape;
  request(args: Args): { method: string; path: string; body?: unknown };
  /** The object the write changes, fetched for the preview. */
  current?(args: Args): string;
  summary(args: Args): string;
}

export interface WriteTool {
  name: string;
  description: string;
  input: z.ZodRawShape;
  write: true;
  run(ctx: ToolContext, args?: Args): Promise<unknown>;
}

export type Tool = ReadTool | WriteTool;

const confirmFields = {
  confirm: z.boolean().optional().describe('Set true, with confirmToken, to perform the change shown in the preview.'),
  confirmToken: z.string().optional().describe('The token a preview returned.'),
};

function writeTool(spec: WriteSpec): WriteTool {
  return {
    name: spec.name,
    description: `${spec.description} Write: the first call returns a preview and a confirmToken; call again with confirm: true and that token to do it.`,
    input: { ...spec.input, ...confirmFields },
    write: true,
    async run(ctx, raw = {}) {
      const { confirm, confirmToken, ...args } = raw as Args & { confirm?: boolean; confirmToken?: string };
      const store = ctx.confirmations;
      if (!store) throw new Error('write tools need a confirmation store');
      const req = spec.request(args);
      if (confirm !== true) {
        const current = spec.current ? await get(ctx, spec.current(args)).catch((e: Error) => ({ error: e.message })) : undefined;
        const { token, expiresAt } = store.issue(spec.name, args);
        return {
          preview: {
            action: spec.summary(args),
            request: req,
            ...(current !== undefined ? { current } : {}),
          },
          confirmToken: token,
          expiresAt,
          next: `Nothing has changed yet. To do this, call ${spec.name} again with the same arguments plus confirm: true and confirmToken: "${token}".`,
        };
      }
      if (!store.consume(spec.name, confirmToken, args)) {
        throw new Error(
          'confirmation refused: the token is missing, expired, already used, or was issued for different arguments. Call without confirm to get a new preview.',
        );
      }
      // The token doubles as the idempotency key, so a retried confirmation can't apply twice.
      return call(ctx, req.method, req.path, req.body, { 'idempotency-key': confirmToken! });
    },
  };
}

const id = z.string().min(1);

export const TOOLS: Tool[] = [
  {
    name: 'list_programs',
    description: 'List the affiliate programs in this organization',
    input: {},
    run: (ctx) => get(ctx, '/v1/programs'),
  },
  {
    name: 'program_overview',
    description: 'Funnel and revenue overview for the last 30 days',
    input: {},
    run: (ctx) => get(ctx, '/v1/analytics/overview?days=30'),
  },
  {
    name: 'partner_performance',
    description: 'Per-partner clicks, referrals, revenue, and commissions',
    input: {},
    run: (ctx) => get(ctx, '/v1/reports/partner-performance'),
  },
  {
    name: 'list_referrals',
    description: 'Recent referrals with attribution channel and status',
    input: {},
    run: (ctx) => get(ctx, '/v1/referrals'),
  },
  {
    name: 'list_fraud_cases',
    description: 'Open fraud cases awaiting review',
    input: {},
    run: (ctx) => get(ctx, '/v1/fraud/cases?status=open'),
  },

  // --- credit ROI (read-only) ---------------------------------------------------
  {
    name: 'roi_summary',
    description:
      'Credit ROI: what the credit you granted (referee rewards, commission credit) cost and what it earned back. ' +
      'Amounts are integer minor units (cents) in the reporting currency unless `currency` is given. ' +
      'cashAfterMinor is real money customers paid after receiving credit; creditCostMinor is what the credit cost you; ' +
      'credit is not real money, so never count it as revenue. profitAfterMinor, netMinor and roi are null when no ' +
      'product margin is set (or a payment lacks one): null means unknown, not zero, so tell the user to set their margin ' +
      'instead of estimating. roi is profit divided by credit cost (2.1 = each unit of credit returned 2.1). ' +
      'Optional filters: from/to (ISO date or instant), programId, partnerId, currency.',
    input: {
      from: z.string().optional().describe('Grants from this ISO date or instant, inclusive.'),
      to: z.string().optional().describe('Up to this instant, or the end of this date (UTC).'),
      programId: z.string().optional(),
      partnerId: z.string().optional(),
      currency: z.string().length(3).optional().describe('Three-letter code; default the reporting currency.'),
    },
    run: (ctx, a = {}) => {
      const q = new URLSearchParams();
      for (const k of ['from', 'to', 'programId', 'partnerId', 'currency'] as const) {
        if (typeof a[k] === 'string' && a[k]) q.set(k, a[k] as string);
      }
      const qs = q.toString();
      return get(ctx, `/v1/roi/summary${qs ? `?${qs}` : ''}`);
    },
  },
  {
    name: 'roi_trace',
    description:
      'The timeline behind a credit ROI figure for ONE customer (customerRef) or ONE partner (partnerId); pass exactly one. ' +
      'It lists grants, credit used, and the cash payments after, so you can explain why a number is what it is. ' +
      'Cash is real money paid; credit is not. Profit fields are null when no margin is set.',
    input: {
      customerRef: z.string().min(1).optional().describe("The merchant's own customer id."),
      partnerId: z.string().min(1).optional().describe('A Referalli partner id.'),
    },
    run: async (ctx, a = {}) => {
      const c = typeof a.customerRef === 'string' && a.customerRef ? a.customerRef : undefined;
      const p = typeof a.partnerId === 'string' && a.partnerId ? a.partnerId : undefined;
      if ((c === undefined) === (p === undefined)) throw new Error('roi_trace needs exactly one of customerRef or partnerId');
      return get(ctx, c !== undefined ? `/v1/roi/trace/${encodeURIComponent(c)}` : `/v1/roi/partners/${encodeURIComponent(p!)}/trace`);
    },
  },
  {
    name: 'roi_patterns',
    description:
      'Customers or partners matching a named credit-ROI pattern: credit_only (used credit, never paid cash), ' +
      'churn_at_exhaustion (stopped paying once credit ran out), bonus_collector (partner collected credit without paying ' +
      'themselves), negative_partner (a partner whose referrals lose money overall). Only subjects whose evidence window ' +
      'has fully elapsed are listed, so a young customer is never flagged. Each entry has a subject and detail amounts in minor units.',
    input: { pattern: z.enum(['credit_only', 'churn_at_exhaustion', 'bonus_collector', 'negative_partner']) },
    run: (ctx, a = {}) => get(ctx, `/v1/roi/patterns/${encodeURIComponent(String(a.pattern))}`),
  },

  // --- writes (preview, then confirm) ------------------------------------------
  writeTool({
    name: 'create_partner',
    description: 'Create a partner.',
    input: { email: z.string().email(), displayName: z.string().min(1), externalRef: z.string().optional() },
    request: (a) => ({ method: 'POST', path: '/v1/partners', body: a }),
    summary: (a) => `Create partner ${String(a.displayName)} <${String(a.email)}>`,
  }),
  writeTool({
    name: 'create_link',
    description: "Create a tracked link for a partner in a program.",
    input: { programId: id, partnerId: id, destinationUrl: z.string().url(), code: z.string().optional() },
    request: (a) => ({ method: 'POST', path: '/v1/links', body: a }),
    summary: (a) => `Create a link for partner ${String(a.partnerId)} → ${String(a.destinationUrl)}`,
  }),
  writeTool({
    name: 'create_coupon',
    description: "Create a coupon code that attributes to a partner.",
    input: { programId: id, partnerId: id, code: z.string().min(2) },
    request: (a) => ({ method: 'POST', path: '/v1/coupons', body: a }),
    summary: (a) => `Create coupon ${String(a.code)} for partner ${String(a.partnerId)}`,
  }),
  writeTool({
    name: 'approve_referral',
    description: 'Approve a referral held for review.',
    input: { referralId: id },
    request: (a) => ({ method: 'POST', path: `/v1/referrals/${encodeURIComponent(String(a.referralId))}/approve` }),
    current: (a) => `/v1/referrals/${encodeURIComponent(String(a.referralId))}`,
    summary: (a) => `Approve referral ${String(a.referralId)} (it starts earning commissions)`,
  }),
  writeTool({
    name: 'void_referral',
    description: 'Void a referral. Permanent: future payments earn nothing.',
    input: { referralId: id },
    request: (a) => ({ method: 'POST', path: `/v1/referrals/${encodeURIComponent(String(a.referralId))}/void` }),
    current: (a) => `/v1/referrals/${encodeURIComponent(String(a.referralId))}`,
    summary: (a) => `Void referral ${String(a.referralId)} permanently`,
  }),
  writeTool({
    name: 'pause_referral',
    description: 'Pause a referral: its payments are recorded but earn nothing until resumed.',
    input: { referralId: id },
    request: (a) => ({ method: 'PATCH', path: `/v1/referrals/${encodeURIComponent(String(a.referralId))}`, body: { status: 'paused' } }),
    current: (a) => `/v1/referrals/${encodeURIComponent(String(a.referralId))}`,
    summary: (a) => `Pause referral ${String(a.referralId)}`,
  }),
  writeTool({
    name: 'resume_referral',
    description: 'Resume a paused referral.',
    input: { referralId: id },
    request: (a) => ({ method: 'PATCH', path: `/v1/referrals/${encodeURIComponent(String(a.referralId))}`, body: { status: 'active' } }),
    current: (a) => `/v1/referrals/${encodeURIComponent(String(a.referralId))}`,
    summary: (a) => `Resume referral ${String(a.referralId)}`,
  }),
  writeTool({
    name: 'approve_due_commissions',
    description: 'Approve every commission line whose hold period has passed.',
    input: {},
    request: () => ({ method: 'POST', path: '/v1/commissions/approve-due' }),
    summary: () => 'Approve all commission lines whose hold has elapsed',
  }),
  writeTool({
    name: 'create_payout_run',
    description: 'Create a payout run (a draft: it is not executed, no money moves).',
    input: {},
    request: () => ({ method: 'POST', path: '/v1/payout-runs' }),
    summary: () => 'Create a payout run from approved balances (not executed)',
  }),
  writeTool({
    name: 'settle_commission',
    description: 'Mark a commission line paid because you credited the partner yourself (store credit).',
    input: { commissionId: id, reference: z.string().min(1), memo: z.string().optional() },
    request: (a) => ({
      method: 'POST',
      path: `/v1/commissions/${encodeURIComponent(String(a.commissionId))}/settle`,
      body: { method: 'store_credit', reference: a.reference, ...(a.memo ? { memo: a.memo } : {}) },
    }),
    current: (a) => `/v1/commissions/${encodeURIComponent(String(a.commissionId))}`,
    summary: (a) => `Settle commission ${String(a.commissionId)} as store credit (reference ${String(a.reference)})`,
  }),
];
