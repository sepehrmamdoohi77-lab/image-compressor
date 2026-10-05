import { test, expect, request as isolatedRequest, type FrameLocator } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

let wrapper: Server;
let wrapperPort: number;
const gameUrl = 'http://localhost:5173/'; // Different site from the wrapper's 127.0.0.1.

test.beforeAll(async () => {
  wrapper = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-store');
    res.end(
      `<!doctype html><html><body style="margin:0;background:#101812"><iframe title="Tactical Arena embedded" src="${gameUrl}" style="width:100vw;height:100vh;border:0" allow="fullscreen"></iframe></body></html>`,
    );
  });
  await new Promise<void>((resolve) => wrapper.listen(0, '0.0.0.0', resolve));
  wrapperPort = (wrapper.address() as AddressInfo).port;
});
test.afterAll(async () => {
  if (wrapper) await new Promise<void>((resolve) => wrapper.close(() => resolve()));
});

async function cookieProfile(frame: FrameLocator) {
  return frame.locator('body').evaluate(async () => {
    const response = await fetch('/arena/api/session', { credentials: 'same-origin' });
    return (await response.json()).profile;
  });
}

test('cross-site iframe can authenticate Quick Play even when its guest cookie is not sent', async ({
  page,
}) => {
  await page.goto(`http://127.0.0.1:${wrapperPort}/`);
  const game = page.frameLocator('iframe');
  await expect(game.locator('[data-service]')).toHaveClass(/is-available/);
  await game.locator('[data-action="quick-play"]').click();
  await game.locator('input[name="name"]').fill('Iframe Operator');
  await game.locator('[data-submit]').click();
  await expect(game.locator('.field-root')).toHaveAttribute('data-phase', 'LOBBY');
  await expect(game.locator('dialog')).not.toBeVisible();
  expect(await cookieProfile(game)).toBeNull(); // Real browser policy, not a fake auth success.
  await leave(game);
});

async function leave(frame: FrameLocator) {
  if (await frame.locator('dialog').isVisible()) await frame.locator('[data-close]').last().click();
  await frame.locator('[data-action="pause"]').click();
  await frame.locator('dialog [data-action="leave"]').click();
  await frame.locator('[data-action="confirm-leave"]').click();
  await expect(frame.locator('.operations-screen')).toBeVisible();
}

test('cookie-restricted iframe creates and plays bot practice, reloads its same identity, and saves loadout', async ({
  page,
}) => {
  await page.goto(`http://127.0.0.1:${wrapperPort}/`);
  let game = page.frameLocator('iframe');
  await expect(game.locator('[data-service]')).toHaveClass(/is-available/);
  await game.locator('[data-action="create"]').click();
  await game.locator('input[name="name"]').fill('Embedded Practice');
  await game.locator('select[name="teamSize"]').selectOption('1');
  await game.locator('select[name="bots"]').selectOption('1');
  await game.locator('select[name="difficulty"]').selectOption('easy');
  await game.locator('[data-submit]').click();
  await expect(game.locator('.field-root')).toHaveAttribute('data-phase', 'LOBBY');
  await expect(game.locator('dialog')).not.toBeVisible();
  const id = await game
    .locator('[data-teams] [data-roster-player]')
    .first()
    .getAttribute('data-roster-player');
  const code = await game.locator('strong[data-room-code]').textContent();
  expect(await cookieProfile(game)).toBeNull();
  await game.locator('[data-ready]').click();
  await game.locator('[data-start]').click();
  await expect(game.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
  await expect(game.locator('[data-health]')).toHaveText('100');
  await page.reload();
  game = page.frameLocator('iframe');
  await expect(game.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
  await expect(game.locator(`[data-roster-player="${id}"]`).first()).toHaveCount(1);
  await expect(game.locator('strong[data-room-code]')).toHaveText(code!);
  expect(await cookieProfile(game)).toBeNull();
  await leave(game);
  await game.locator('[data-action="loadout"]').first().click();
  await game.locator('input[name="primary"][value="dmr"]').check();
  await game.locator('[data-submit]').click();
  await expect(game.locator('dialog')).not.toBeVisible();
  await game.locator('[data-action="loadout"]').first().click();
  await expect(game.locator('input[name="primary"][value="dmr"]')).toBeChecked();
});

test('a preview with all cookies removed still enters a real room, not a fake lobby', async ({
  page,
}) => {
  // This additional transport boundary removes Cookie/Set-Cookie explicitly.
  // Requests still go to the actual backend; no successful response is mocked.
  const proxy = await isolatedRequest.newContext();
  await page.route('**/arena/api/**', async (route) => {
    const headers = route.request().headers();
    headers.cookie = '';
    const response = await proxy.fetch(route.request(), { headers });
    const returned = { ...response.headers() };
    delete returned['set-cookie'];
    await route.fulfill({ response, headers: returned });
  });
  await page.goto('/');
  await expect(page.locator('[data-service]')).toHaveClass(/is-available/);
  await page.locator('[data-action="create"]').click();
  await page.locator('input[name="name"]').fill('No Cookie Guest');
  await page.locator('select[name="teamSize"]').selectOption('1');
  await page.locator('select[name="bots"]').selectOption('1');
  await page.locator('[data-submit]').click();
  await expect(page.locator('.field-root')).toHaveAttribute('data-phase', 'LOBBY');
  await expect(page.locator('dialog')).not.toBeVisible();
  expect((await page.context().cookies()).length).toBe(0);
  await page.locator('[data-ready]').click();
  await page.locator('[data-start]').click();
  await expect(page.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
  await expect(page.locator('[data-health]')).toHaveText('100');
  await page.locator('[data-action="pause"]').click();
  await page.locator('dialog [data-action="leave"]').click();
  await page.locator('[data-action="confirm-leave"]').click();
  await expect(page.locator('.operations-screen')).toBeVisible();
  await proxy.dispose();
});
