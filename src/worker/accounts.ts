import { HttpError } from './service';
import { PingStepD1Repository, StoredUser } from './repository';

const encoder = new TextEncoder();
const SESSION_COOKIE = '__Host-pingstep_session';
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 30;
export type Account = { id: string; email: string };
type OAuthProvider = 'github' | 'google';
type OAuthProfile = { subject: string; email: string };

const hex = (bytes: Uint8Array) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
const bytesFromHex = (value: string) => new Uint8Array(value.match(/.{1,2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);

async function sha256Hex(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

function sessionToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `ps_session_${hex(bytes)}`;
}

function readCookie(request: Request): string | null {
  const pair = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  return pair ? decodeURIComponent(pair.slice(SESSION_COOKIE.length + 1)) : null;
}

function cookie(value: string, maxAge: number): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Cross-site request rejected.');
}

function providerFrom(value: string): OAuthProvider {
  if (value === 'github' || value === 'google') return value;
  throw new HttpError(404, 'Authentication provider not found.');
}

function secret(env: Env, name: string): string | null {
  const value = Reflect.get(env, name);
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function randomToken(prefix: string): string {
  return `${prefix}_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
}

function callbackUrl(env: Env, provider: OAuthProvider): string {
  return new URL(`/v1/auth/${provider}/callback`, env.PUBLIC_ORIGIN).toString();
}

function accountErrorRedirect(env: Env): Response {
  return Response.redirect(new URL('/app?auth_error=1', env.PUBLIC_ORIGIN).toString(), 302);
}

async function establishSession(repository: PingStepD1Repository, user: Account): Promise<{ user: Account; cookie: string }> {
  const token = sessionToken();
  const now = new Date();
  await repository.createSession({
    id: crypto.randomUUID(), user_id: user.id, token_hash: await sha256Hex(token),
    created_at: now.toISOString(), expires_at: new Date(now.getTime() + SESSION_AGE_SECONDS * 1000).toISOString()
  });
  return { user, cookie: cookie(token, SESSION_AGE_SECONDS) };
}

export async function startOAuth(request: Request, env: Env, repository: PingStepD1Repository, providerName: string): Promise<Response> {
  const provider = providerFrom(providerName);
  const clientId = secret(env, provider === 'github' ? 'GITHUB_CLIENT_ID' : 'GOOGLE_CLIENT_ID');
  if (!clientId) throw new HttpError(503, `${provider === 'github' ? 'GitHub' : 'Google'} sign-in is not configured yet.`);
  const state = randomToken('ps_oauth');
  await repository.createOAuthState(state, provider, new Date(Date.now() + 10 * 60 * 1000).toISOString());
  const authorize = new URL(provider === 'github' ? 'https://github.com/login/oauth/authorize' : 'https://accounts.google.com/o/oauth2/v2/auth');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('redirect_uri', callbackUrl(env, provider));
  authorize.searchParams.set('state', state);
  if (provider === 'github') {
    authorize.searchParams.set('scope', 'read:user user:email');
  } else {
    authorize.searchParams.set('response_type', 'code');
    authorize.searchParams.set('scope', 'openid email profile');
    authorize.searchParams.set('prompt', 'select_account');
  }
  return Response.redirect(authorize.toString(), 302);
}

async function tokenFrom(provider: OAuthProvider, code: string, env: Env): Promise<string> {
  const clientId = secret(env, provider === 'github' ? 'GITHUB_CLIENT_ID' : 'GOOGLE_CLIENT_ID');
  const clientSecret = secret(env, provider === 'github' ? 'GITHUB_CLIENT_SECRET' : 'GOOGLE_CLIENT_SECRET');
  if (!clientId || !clientSecret) throw new HttpError(503, 'Social sign-in is not configured yet.');
  const response = await fetch(provider === 'github' ? 'https://github.com/login/oauth/access_token' : 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: callbackUrl(env, provider), ...(provider === 'google' ? { grant_type: 'authorization_code' } : {}) })
  });
  const body = await response.json() as { access_token?: unknown };
  if (!response.ok || typeof body.access_token !== 'string') throw new HttpError(502, 'Social sign-in could not be completed.');
  return body.access_token;
}

function verifiedEmail(value: unknown): string | null {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) ? value.trim().toLowerCase() : null;
}

async function profileFrom(provider: OAuthProvider, accessToken: string): Promise<OAuthProfile> {
  if (provider === 'github') {
    const userResponse = await fetch('https://api.github.com/user', { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'PingStep' } });
    const user = await userResponse.json() as { id?: unknown; email?: unknown };
    if (!userResponse.ok || (typeof user.id !== 'number' && typeof user.id !== 'string')) throw new HttpError(502, 'GitHub profile could not be read.');
    let email = verifiedEmail(user.email);
    if (!email) {
      const emailsResponse = await fetch('https://api.github.com/user/emails', { headers: { authorization: `Bearer ${accessToken}`, accept: 'application/vnd.github+json', 'user-agent': 'PingStep' } });
      const emails = await emailsResponse.json() as Array<{ email?: unknown; primary?: unknown; verified?: unknown }>;
      const primary = Array.isArray(emails) ? emails.find((item) => item.primary === true && item.verified === true) : undefined;
      email = verifiedEmail(primary?.email);
    }
    if (!email) throw new HttpError(400, 'GitHub must provide a verified primary email address.');
    return { subject: String(user.id), email };
  }
  const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
  const user = await response.json() as { sub?: unknown; email?: unknown; email_verified?: unknown };
  const email = verifiedEmail(user.email);
  if (!response.ok || typeof user.sub !== 'string' || user.email_verified !== true || !email) throw new HttpError(502, 'Google profile could not be verified.');
  return { subject: user.sub, email };
}

async function accountForProfile(repository: PingStepD1Repository, provider: OAuthProvider, profile: OAuthProfile): Promise<Account> {
  const identified = await repository.getUserByOAuthIdentity(provider, profile.subject);
  if (identified) return identified;
  let user = await repository.getUserByEmail(profile.email);
  const now = new Date().toISOString();
  if (!user) {
    user = { id: crypto.randomUUID(), email: profile.email, password_hash: 'external-identity-only', created_at: now } satisfies StoredUser;
    await repository.createUser(user);
  }
  await repository.createOAuthIdentity(provider, profile.subject, user.id, now);
  return { id: user.id, email: user.email };
}

export async function completeOAuth(request: Request, env: Env, repository: PingStepD1Repository, providerName: string): Promise<Response> {
  const provider = providerFrom(providerName);
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const code = url.searchParams.get('code');
  if (!state || !code || !await repository.consumeOAuthState(state, provider, new Date().toISOString())) return accountErrorRedirect(env);
  try {
    const profile = await profileFrom(provider, await tokenFrom(provider, code, env));
    const session = await establishSession(repository, await accountForProfile(repository, provider, profile));
    return new Response(null, {
      status: 302,
      headers: { location: new URL('/app', env.PUBLIC_ORIGIN).toString(), 'set-cookie': session.cookie }
    });
  } catch (error) {
    if (error instanceof HttpError) return accountErrorRedirect(env);
    throw error;
  }
}

export async function currentAccount(request: Request, repository: PingStepD1Repository): Promise<Account | null> {
  const token = readCookie(request);
  if (!token) return null;
  const session = await repository.getSessionByTokenHash(await sha256Hex(token), new Date().toISOString());
  return session ? { id: session.user_id, email: session.email } : null;
}

export async function requireAccount(request: Request, repository: PingStepD1Repository): Promise<Account> {
  const account = await currentAccount(request, repository);
  if (!account) throw new HttpError(401, 'Sign in to continue.');
  return account;
}

export async function signOut(request: Request, repository: PingStepD1Repository): Promise<string> {
  const token = readCookie(request);
  if (token) await repository.deleteSessionByTokenHash(await sha256Hex(token));
  return cookie('', 0);
}
