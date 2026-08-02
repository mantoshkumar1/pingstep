import { expect, test } from '@playwright/test';

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
});
