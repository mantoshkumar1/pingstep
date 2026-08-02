# Social sign-in setup

PingStep supports GitHub and Google sign-in without storing user passwords or sending email. A provider starts working as soon as its two Worker secrets are configured.

## GitHub OAuth app

Create an OAuth App in the GitHub account that owns PingStep.

- Application homepage URL: `https://pingstep.dev`
- Authorization callback URL: `https://pingstep.dev/v1/auth/github/callback`
- Required scope: `read:user user:email`

Set the returned values as Worker secrets; never commit them:

```sh
npx wrangler secret put GITHUB_CLIENT_ID
npx wrangler secret put GITHUB_CLIENT_SECRET
```

## Google OAuth client

Create a Web application OAuth client in Google Cloud.

- Authorized JavaScript origin: `https://pingstep.dev`
- Authorized redirect URI: `https://pingstep.dev/v1/auth/google/callback`
- Required scopes: `openid email profile`

Set the returned values as Worker secrets:

```sh
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
```

## Security behavior

- PingStep creates a short-lived, single-use OAuth state for every sign-in attempt.
- Provider client secrets remain in Worker secrets, never in source control or the browser.
- PingStep requires a verified email address from either provider.
- A session cookie is `Secure`, `HttpOnly`, `SameSite=Strict`, and expires after 30 days.
