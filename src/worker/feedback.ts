import { HttpError } from './service.ts';
import { insertFeedback, countRecentFeedbackByIp, type FeedbackRecord } from './repository.ts';

const MAX_MESSAGE_LENGTH = 2000;
const MAX_EMAIL_LENGTH = 254;
const RATE_LIMIT_WINDOW_MINUTES = 60;
const RATE_LIMIT_MAX = 5;

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function secret(env: Env, name: string): string | undefined {
  const value = Reflect.get(env, name);
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export async function submitFeedback(
  db: D1Database,
  env: Env,
  input: unknown,
  clientIp: string | null
): Promise<{ ok: true }> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpError(400, 'Feedback must be a JSON object.');
  }
  const { message, email, page } = input as { message?: unknown; email?: unknown; page?: unknown };

  if (typeof message !== 'string' || message.trim().length === 0) {
    throw new HttpError(400, 'Message is required.');
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    throw new HttpError(400, `Message must be ${MAX_MESSAGE_LENGTH} characters or fewer.`);
  }

  let validatedEmail: string | null = null;
  if (email !== undefined && email !== null && email !== '') {
    if (typeof email !== 'string' || email.length > MAX_EMAIL_LENGTH || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new HttpError(400, 'Email address is not valid.');
    }
    validatedEmail = email.trim().toLowerCase();
  }

  const validatedPage = typeof page === 'string' && page.length <= 200 ? page : null;

  const ipHash = clientIp ? await sha256Hex(clientIp) : null;

  if (ipHash) {
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60 * 1000).toISOString();
    const recent = await countRecentFeedbackByIp(db, ipHash, since);
    if (recent >= RATE_LIMIT_MAX) {
      throw new HttpError(429, 'Too many submissions. Try again later.');
    }
  }

  const record: FeedbackRecord = {
    id: crypto.randomUUID(),
    message: message.trim(),
    email: validatedEmail,
    page: validatedPage,
    ip_hash: ipHash,
    created_at: new Date().toISOString()
  };

  await insertFeedback(db, record);

  // Fire-and-forget webhook notification
  const webhookUrl = secret(env, 'FEEDBACK_WEBHOOK_URL');
  if (webhookUrl) {
    const webhookToken = secret(env, 'FEEDBACK_WEBHOOK_TOKEN');
    try {
      await fetch(webhookUrl, {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
        headers: {
          'content-type': 'application/json',
          ...(webhookToken ? { authorization: `Bearer ${webhookToken}` } : {})
        },
        body: JSON.stringify({
          type: 'feedback',
          id: record.id,
          message: record.message,
          email: record.email ?? '(anonymous)',
          page: record.page,
          created_at: record.created_at
        })
      });
    } catch {
      // Feedback is saved regardless — webhook failure is not user-facing
    }
  }

  return { ok: true };
}
