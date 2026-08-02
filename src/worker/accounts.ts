import { HttpError } from './service';
import { PingStepD1Repository, StoredUser } from './repository';

const encoder = new TextEncoder();
const SESSION_COOKIE = '__Host-pingstep_session';
const SESSION_AGE_SECONDS = 60 * 60 * 24 * 30;
const PASSWORD_ITERATIONS = 600_000;

type Credentials = { email?: unknown; password?: unknown };
export type Account = { id: string; email: string };

const hex = (bytes: Uint8Array) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
const bytesFromHex = (value: string) => new Uint8Array(value.match(/.{1,2}/g)?.map((part) => Number.parseInt(part, 16)) ?? []);

async function sha256Hex(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function passwordDigest(password: string, salt: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSWORD_ITERATIONS }, material, 256);
  return hex(new Uint8Array(derived));
}

async function passwordHash(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2-sha256$${PASSWORD_ITERATIONS}$${hex(salt)}$${await passwordDigest(password, salt)}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [algorithm, iterations, saltValue, digest] = stored.split('$');
  if (algorithm !== 'pbkdf2-sha256' || Number(iterations) !== PASSWORD_ITERATIONS || !saltValue || !digest) return false;
  const actual = bytesFromHex(await passwordDigest(password, bytesFromHex(saltValue)));
  const expected = bytesFromHex(digest);
  return actual.length === expected.length && crypto.subtle.timingSafeEqual(actual, expected);
}

function parseCredentials(raw: unknown): { email: string; password: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'Email and password are required.');
  const { email, password } = raw as Credentials;
  if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new HttpError(400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 200) throw new HttpError(400, 'Password must be 12–200 characters.');
  return { email: email.trim().toLowerCase(), password };
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

async function establishSession(repository: PingStepD1Repository, user: Account): Promise<{ user: Account; cookie: string }> {
  const token = sessionToken();
  const now = new Date();
  await repository.createSession({
    id: crypto.randomUUID(), user_id: user.id, token_hash: await sha256Hex(token),
    created_at: now.toISOString(), expires_at: new Date(now.getTime() + SESSION_AGE_SECONDS * 1000).toISOString()
  });
  return { user, cookie: cookie(token, SESSION_AGE_SECONDS) };
}

export async function signUp(repository: PingStepD1Repository, raw: unknown) {
  const { email, password } = parseCredentials(raw);
  if (await repository.getUserByEmail(email)) throw new HttpError(409, 'An account already exists for that email. Sign in instead.');
  const user: StoredUser = { id: crypto.randomUUID(), email, password_hash: await passwordHash(password), created_at: new Date().toISOString() };
  await repository.createUser(user);
  return establishSession(repository, { id: user.id, email: user.email });
}

export async function signIn(repository: PingStepD1Repository, raw: unknown) {
  const { email, password } = parseCredentials(raw);
  const user = await repository.getUserByEmail(email);
  if (!user || !await passwordMatches(password, user.password_hash)) throw new HttpError(401, 'Email or password is incorrect.');
  return establishSession(repository, { id: user.id, email: user.email });
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
