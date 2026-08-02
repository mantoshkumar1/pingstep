import { type Account } from './accounts.ts';
import { type PlanCode } from './plans.ts';
import { type AccountPlan, PingStepD1Repository, type StoredBillingSubscription } from './repository.ts';
import { HttpError } from './service.ts';

type StripeConfig = { secretKey: string; webhookSecret: string; proPriceId: string; teamPriceId: string; publicOrigin: string };
type StripeSubscription = { id?: unknown; customer?: unknown; status?: unknown; current_period_end?: unknown; metadata?: { user_id?: unknown }; items?: { data?: Array<{ price?: { id?: unknown } }> } };
type StripeEvent = { type?: unknown; data?: { object?: Record<string, unknown> } };
const encoder = new TextEncoder();
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

function setting(env: Env, name: string): string | null {
  const value = Reflect.get(env, name);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function config(env: Env): StripeConfig | null {
  const secretKey = setting(env, 'STRIPE_SECRET_KEY');
  const webhookSecret = setting(env, 'STRIPE_WEBHOOK_SECRET');
  const proPriceId = setting(env, 'STRIPE_PRO_PRICE_ID');
  const teamPriceId = setting(env, 'STRIPE_TEAM_PRICE_ID');
  return secretKey && webhookSecret && proPriceId && teamPriceId ? { secretKey, webhookSecret, proPriceId, teamPriceId, publicOrigin: env.PUBLIC_ORIGIN } : null;
}

const hex = (bytes: Uint8Array) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
function equal(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}
async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}
function priceFor(plan: PlanCode, settings: StripeConfig): string {
  if (plan === 'pro') return settings.proPriceId;
  if (plan === 'team') return settings.teamPriceId;
  throw new HttpError(400, 'Choose Pro or Team.');
}
async function stripe(settings: StripeConfig, path: string, body?: URLSearchParams): Promise<Record<string, unknown>> {
  const response = await fetch(`https://api.stripe.com${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${settings.secretKey}`, ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body });
  const result = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new HttpError(502, 'Payment service could not complete the request.');
  return result;
}

async function readWebhookBody(request: Request): Promise<string> {
  const contentLength = request.headers.get('content-length');
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_WEBHOOK_BODY_BYTES)) throw new HttpError(413, 'Request body is too large.');
  if (!request.body) throw new HttpError(400, 'Request body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BODY_BYTES) {
      await reader.cancel();
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export function resolveBillingEntitlement(subscriptions: readonly Pick<StoredBillingSubscription, 'plan' | 'status' | 'current_period_end'>[], now: string): AccountPlan {
  const nowMs = Date.parse(now);
  const paid = subscriptions.filter((subscription) =>
    (subscription.status === 'active' || subscription.status === 'trialing') &&
    (!subscription.current_period_end || Date.parse(subscription.current_period_end) > nowMs)
  );
  if (paid.length === 0) return { plan: 'trial', active_until: null };
  paid.sort((left, right) => {
    const rightEnds = right.current_period_end ? Date.parse(right.current_period_end) : Number.POSITIVE_INFINITY;
    const leftEnds = left.current_period_end ? Date.parse(left.current_period_end) : Number.POSITIVE_INFINITY;
    if (rightEnds !== leftEnds) return rightEnds - leftEnds;
    return (right.plan === 'team' ? 1 : 0) - (left.plan === 'team' ? 1 : 0);
  });
  return { plan: paid[0].plan, active_until: paid[0].current_period_end };
}

/**
 * Stripe can change an existing subscription to `past_due` when an immediate,
 * prorated plan change cannot be collected. Keep the access that was already
 * paid for until its existing end date; a failed collection must not turn a
 * paid customer into a trial customer mid-period.
 */
function retainPriorPaidEntitlementOnCollectionFailure(entitlement: AccountPlan, prior: AccountPlan, status: string, now: string): AccountPlan {
  const priorIsCurrent = prior.plan !== 'trial' && (!prior.active_until || Date.parse(prior.active_until) > Date.parse(now));
  if (entitlement.plan === 'trial' && priorIsCurrent && (status === 'past_due' || status === 'unpaid')) return prior;
  return entitlement;
}

export async function createCheckout(env: Env, repository: PingStepD1Repository, account: Account, requestedPlan: unknown): Promise<{ url: string }> {
  if (requestedPlan !== 'pro' && requestedPlan !== 'team') throw new HttpError(400, 'Choose Pro or Team.');
  const settings = config(env);
  if (!settings) throw new HttpError(503, 'Billing is being configured. Please try again shortly.');
  const existing = await repository.listBillingSubscriptionsForUser(account.id);
  if (resolveBillingEntitlement(existing, new Date().toISOString()).plan !== 'trial') {
    throw new HttpError(409, 'You already have an active paid plan. Use Manage billing to update it.');
  }
  const params = new URLSearchParams({
    mode: 'subscription', customer_email: account.email, client_reference_id: account.id,
    success_url: new URL('/app?checkout=success', settings.publicOrigin).toString(),
    cancel_url: new URL('/pricing.html?checkout=cancelled', settings.publicOrigin).toString(),
    'line_items[0][price]': priceFor(requestedPlan, settings), 'line_items[0][quantity]': '1',
    'metadata[user_id]': account.id, 'subscription_data[metadata][user_id]': account.id
  });
  const session = await stripe(settings, '/v1/checkout/sessions', params);
  if (typeof session.url !== 'string' || !session.url.startsWith('https://')) throw new HttpError(502, 'Payment service returned an invalid checkout link.');
  return { url: session.url };
}

function verifySignature(raw: string, header: string | null, secret: string): Promise<boolean> {
  const timestamp = header?.split(',').find((part) => part.startsWith('t='))?.slice(2);
  const signatures = header?.split(',').filter((part) => part.startsWith('v1=')).map((part) => part.slice(3)) ?? [];
  if (!timestamp || !/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 || signatures.length === 0) return Promise.resolve(false);
  return hmac(secret, `${timestamp}.${raw}`).then((expected) => signatures.some((signature) => equal(signature, expected)));
}

async function syncSubscription(repository: PingStepD1Repository, settings: StripeConfig, subscription: StripeSubscription, userId: string | null): Promise<void> {
  const id = typeof subscription.id === 'string' ? subscription.id : null;
  const customerId = typeof subscription.customer === 'string' ? subscription.customer : null;
  const status = typeof subscription.status === 'string' ? subscription.status : null;
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const plan = priceId === settings.proPriceId ? 'pro' : priceId === settings.teamPriceId ? 'team' : null;
  const owner = userId ?? (id ? (await repository.getBillingSubscription(id))?.user_id ?? null : null);
  if (!id || !customerId || !status || !plan || !owner) return;
  const periodEnd = typeof subscription.current_period_end === 'number' ? new Date(subscription.current_period_end * 1000).toISOString() : null;
  const now = new Date().toISOString();
  const priorEntitlement = await repository.getAccountPlan(owner, now);
  await repository.upsertBillingSubscription({ stripe_subscription_id: id, user_id: owner, stripe_customer_id: customerId, plan, status, current_period_end: periodEnd, updated_at: now });
  const entitlement = retainPriorPaidEntitlementOnCollectionFailure(
    resolveBillingEntitlement(await repository.listBillingSubscriptionsForUser(owner), now), priorEntitlement, status, now
  );
  await repository.setAccountPlan(owner, entitlement.plan, entitlement.active_until, now);
}

export async function handleStripeWebhook(request: Request, env: Env, repository: PingStepD1Repository): Promise<void> {
  const settings = config(env);
  if (!settings) throw new HttpError(503, 'Billing is not configured.');
  const raw = await readWebhookBody(request);
  if (!await verifySignature(raw, request.headers.get('stripe-signature'), settings.webhookSecret)) throw new HttpError(400, 'Invalid Stripe signature.');
  let event: StripeEvent;
  try {
    event = JSON.parse(raw) as StripeEvent;
  } catch {
    throw new HttpError(400, 'Request body must be valid JSON.');
  }
  const object = event.data?.object;
  if (!object) return;
  let subscription: StripeSubscription | null = null;
  let userId: string | null = null;
  if (event.type === 'checkout.session.completed') {
    const subscriptionId = typeof object.subscription === 'string' ? object.subscription : null;
    const metadata = object.metadata as { user_id?: unknown } | undefined;
    userId = typeof object.client_reference_id === 'string' ? object.client_reference_id : typeof metadata?.user_id === 'string' ? metadata.user_id : null;
    if (subscriptionId) subscription = await stripe(settings, `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`) as StripeSubscription;
  } else if (event.type === 'customer.subscription.created' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const subscriptionId = typeof object.id === 'string' ? object.id : null;
    if (subscriptionId) subscription = await stripe(settings, `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`) as StripeSubscription;
    userId = typeof subscription?.metadata?.user_id === 'string' ? subscription.metadata.user_id : null;
  } else if (event.type === 'invoice.payment_failed' && typeof object.subscription === 'string') {
    subscription = await stripe(settings, `/v1/subscriptions/${encodeURIComponent(object.subscription)}`) as StripeSubscription;
  }
  if (subscription) await syncSubscription(repository, settings, subscription, userId);
}

export async function createPortal(env: Env, repository: PingStepD1Repository, account: Account): Promise<{ url: string }> {
  const settings = config(env);
  if (!settings) throw new HttpError(503, 'Billing is being configured. Please try again shortly.');
  const subscription = await repository.getBillingSubscriptionForUser(account.id);
  if (!subscription) throw new HttpError(404, 'No subscription was found for this account.');
  const portal = await stripe(settings, '/v1/billing_portal/sessions', new URLSearchParams({ customer: subscription.stripe_customer_id, return_url: new URL('/app', settings.publicOrigin).toString() }));
  if (typeof portal.url !== 'string' || !portal.url.startsWith('https://')) throw new HttpError(502, 'Payment service returned an invalid billing link.');
  return { url: portal.url };
}
