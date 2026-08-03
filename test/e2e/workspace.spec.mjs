import { expect, test } from '@playwright/test';

test('customer support is available at the clean contact URL', async ({ page }) => {
  await page.goto('/contact');
  await expect(page).toHaveTitle('Contact PingStep support');
  await expect(page.getByRole('heading', { name: 'Contact PingStep' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'mantoshk234@gmail.com' })).toHaveAttribute('href', /mailto:/);
});

test('language choice persists and the landing page is usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.locator('#language').selectOption('es');
  await page.waitForLoadState('domcontentloaded');
  await expect(page.locator('h1')).toHaveText('Vea dónde está su tarea.');
  await page.reload();
  await expect(page.locator('#language')).toHaveValue('es');
  await expect(page.getByRole('link', { name: 'Abrir panel' })).toBeVisible();
});

test('signed-in user can create a job without exposing workflow details', async ({ page }) => {
  await page.route('**/v1/auth/me', route => route.fulfill({ json: { user: { email: 'engineer@example.test' } } }));
  await page.route('**/v1/account/usage', route => route.fulfill({ json: { plan: 'trial' } }));
  await page.route('**/v1/runs', route => route.fulfill({ json: { runs: [] } }));
  await page.route('**/v1/jobs', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { jobs: [] } });
    return route.fulfill({ status: 201, json: { token: 'ps_job_test', viewer_token: 'ps_view_test' } });
  });
  await page.goto('/app');
  await page.locator('input[name="job_key"]').fill('nightly-backup');
  await page.locator('#job-form button').click();
  await expect(page.locator('#job-token')).toHaveText('ps_job_test');
  await expect(page.locator('#viewer-token')).toHaveText('ps_view_test');
  await expect(page.locator('#tokens')).toBeVisible();
  await expect(page.locator('input[name="job_key"]')).toHaveValue('');
});

test('owner can rotate tokens and delete a job only after exact-key confirmation', async ({ page }) => {
  let jobs = [{ job_key: 'nightly-backup' }];
  const confirmations = [];
  await page.route('**/v1/auth/me', route => route.fulfill({ json: { user: { email: 'engineer@example.test' } } }));
  await page.route('**/v1/account/usage', route => route.fulfill({ json: { plan: 'trial' } }));
  await page.route('**/v1/runs', route => route.fulfill({ json: { runs: [] } }));
  await page.route('**/v1/jobs**', async route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { jobs } });
    const body = JSON.parse(request.postData() || '{}');
    confirmations.push(body.confirm_job_key);
    if (request.url().endsWith('/tokens/rotate')) return route.fulfill({ json: { token: 'ps_job_rotated', viewer_token: 'ps_view_rotated' } });
    jobs = [];
    return route.fulfill({ json: { ok: true } });
  });
  page.on('dialog', dialog => dialog.accept('nightly-backup'));
  await page.goto('/app');
  await expect(page.getByRole('button', { name: 'Rotate tokens' })).toBeVisible();
  await page.getByRole('button', { name: 'Rotate tokens' }).click();
  await expect(page.locator('#job-token')).toHaveText('ps_job_rotated');
  await page.getByRole('button', { name: 'Delete job' }).click();
  await expect(page.locator('#jobs')).toContainText('No jobs yet.');
  expect(confirmations).toEqual(['nightly-backup', 'nightly-backup']);
});
