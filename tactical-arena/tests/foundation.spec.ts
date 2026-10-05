import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const qaDir = path.resolve('../.arena/qa');
fs.mkdirSync(qaDir, { recursive: true });

async function create(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await expect(page.locator('[data-service]')).toHaveClass(/is-available/);
  await page.locator('[data-action="create"]').click();
  await page.locator('input[name="name"]').fill(name);
  await page.locator('select[name="timeLimitSeconds"]').selectOption('600');
  await page.locator('select[name="mode"]').selectOption('NETWORK_DRILL');
  await page.locator('[data-submit]').click();
  await expect(page.locator('.field-root')).toHaveAttribute('data-phase', 'LOBBY');
  await expect(page.locator('dialog')).not.toBeVisible();
  await expect(page.locator('.arena-canvas')).toBeVisible();
  return (await page.locator('strong[data-room-code]').textContent())!;
}
async function join(page: Page, code: string, name: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-service]')).toHaveClass(/is-available/);
  await page.locator('[data-action="join"]').click();
  await page.locator('input[name="name"]').fill(name);
  await page.locator('input[name="code"]').fill(code);
  await page.locator('[data-submit]').click();
  await expect(page.locator('.field-root')).toHaveAttribute('data-phase', 'LOBBY');
  await expect(page.locator('dialog')).not.toBeVisible();
  await expect(page.locator('.arena-canvas')).toBeVisible();
}
async function identity(page: Page): Promise<string> {
  return (await (await page.request.get('/arena/api/session')).json()).profile.id;
}
async function position(page: Page, id: string): Promise<{ x: number; z: number; yaw: number }> {
  const actor = page.locator(`.operator-label[data-player-id="${id}"]`);
  return {
    x: Number(await actor.getAttribute('data-x')),
    z: Number(await actor.getAttribute('data-z')),
    yaw: Number(await actor.getAttribute('data-yaw')),
  };
}
async function active(first: Page, second: Page): Promise<void> {
  await first.locator('[data-ready]').click();
  await second.locator('[data-ready]').click();
  await expect(first.locator('[data-start]')).toBeEnabled();
  await first.locator('[data-start]').click();
  await expect(first.locator('.field-root')).toHaveAttribute('data-phase', 'COUNTDOWN');
  await expect(second.locator('.field-root')).toHaveAttribute('data-phase', 'COUNTDOWN');
  await expect(first.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
  await expect(second.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
}
async function leave(page: Page): Promise<void> {
  if (await page.locator('dialog').isVisible()) await page.locator('[data-close]').first().click();
  await page.locator('[data-action="pause"]').click();
  await page.locator('dialog [data-action="leave"]').click();
  await page.locator('[data-action="confirm-leave"]').click();
  await expect(page.locator('.operations-screen')).toBeVisible();
}
async function testPrefs(context: BrowserContext): Promise<void> {
  await context.addInitScript(() =>
    localStorage.setItem(
      'tactical-arena.settings.v1',
      JSON.stringify({
        version: 1,
        quality: 'low',
        zoom: 16,
        rotationSpeed: 1,
        touchScale: 1,
        gamepadDeadzone: 0.18,
        fpsTarget: 30,
      }),
    ),
  );
}

test('two independent clients create, join, see each other, move both ways, aim, reconnect and leave', async ({
  browser,
}) => {
  const a = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const independentBrowser = await browser.browserType().launch({
    executablePath: process.env.ARENA_CHROMIUM_PATH,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  const b = await independentBrowser.newContext({ viewport: { width: 1280, height: 800 } });
  await testPrefs(a);
  await testPrefs(b);
  // Test-only transport interception; both sockets still connect to the real server.
  await b.addInitScript(() => {
    const sockets: WebSocket[] = [];
    (window as unknown as { qaSockets: WebSocket[] }).qaSockets = sockets;
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        sockets.push(this);
      }
    };
  });
  const first = await a.newPage(),
    second = await b.newPage();
  const errors: string[] = [];
  for (const page of [first, second]) {
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
  }
  try {
    await first.goto('/');
    await expect(first.locator('[data-service]')).toHaveClass(/is-available/);
    await first.screenshot({ path: path.join(qaDir, 'menu-desktop.png') });
    const code = await create(first, 'Alpha-Test');
    await expect(first.locator('[data-start]')).toBeDisabled();
    await join(second, code, 'Bravo-Test');
    const idA = await identity(first),
      idB = await identity(second);
    expect(idA).not.toBe(idB);
    await expect(first.locator('.operator-label')).toHaveCount(2);
    await expect(second.locator('.operator-label')).toHaveCount(2);
    await expect(first.locator('[data-teams]')).toContainText('Bravo-Test');
    await expect(second.locator('[data-teams]')).toContainText('Alpha-Test');
    await first.screenshot({ path: path.join(qaDir, 'lobby-desktop.png') });
    await first.setViewportSize({ width: 1024, height: 720 });
    await second.setViewportSize({ width: 900, height: 650 });
    await active(first, second);
    const originalA = await position(second, idA);
    await first.bringToFront();
    await first.locator('.arena-canvas').click({ position: { x: 720, y: 430 } });
    await first.mouse.move(890, 470);
    expect(await first.evaluate(() => document.hidden)).toBe(false);
    await first.keyboard.down('KeyW');
    try {
      await expect
        .poll(async () => {
          const p = await position(second, idA);
          return Math.hypot(p.x - originalA.x, p.z - originalA.z);
        })
        .toBeGreaterThan(1);
    } finally {
      await first.keyboard.up('KeyW');
    }
    const originalB = await position(first, idB);
    await second.bringToFront();
    await second.locator('.arena-canvas').click({ position: { x: 700, y: 410 } });
    await second.keyboard.down('KeyS');
    try {
      await expect
        .poll(async () => {
          const p = await position(first, idB);
          return Math.hypot(p.x - originalB.x, p.z - originalB.z);
        })
        .toBeGreaterThan(1);
    } finally {
      await second.keyboard.up('KeyS');
    }
    await first.mouse.move(1000, 350);
    await expect
      .poll(async () => {
        const local = await position(first, idA),
          remote = await position(second, idA);
        return Math.abs(
          Math.atan2(Math.sin(local.yaw - remote.yaw), Math.cos(local.yaw - remote.yaw)),
        );
      })
      .toBeLessThan(0.15);
    await expect
      .poll(async () => {
        const local = await position(first, idA),
          remote = await position(second, idA);
        return Math.hypot(local.x - remote.x, local.z - remote.z);
      })
      .toBeLessThan(0.4);
    const timerA = await first.locator('[data-timer]').textContent(),
      timerB = await second.locator('[data-timer]').textContent();
    const seconds = (text: string | null) =>
      text!.split(':').reduce((a, s) => a * 60 + Number(s), 0);
    expect(Math.abs(seconds(timerA) - seconds(timerB))).toBeLessThanOrEqual(1);
    // Verify the field-settings path (not just the menu) and actual mutual visibility.
    for (const page of [first, second]) {
      await page.locator('[data-action="pause"]').click();
      await page.locator('dialog [data-action="settings"]').click();
      await page.locator('input[name="zoom"]').focus();
      await page.locator('input[name="zoom"]').press('End');
      await expect(page.locator('[data-output="zoom"]')).toHaveText('22');
      await page.locator('dialog [data-close]').last().click();
    }
    await expect(first.locator(`.operator-label[data-player-id="${idB}"]`)).toBeVisible();
    await expect(second.locator(`.operator-label[data-player-id="${idA}"]`)).toBeVisible();
    await first.screenshot({ path: path.join(qaDir, 'field-desktop.png') });
    await first.keyboard.press('Escape');
    await expect(first.locator('dialog')).toBeVisible();
    const pausedA = await position(second, idA),
      runningB = await position(first, idB);
    await first.keyboard.down('KeyW');
    await second.keyboard.down('KeyD');
    try {
      await expect
        .poll(async () => {
          const p = await position(first, idB);
          return Math.hypot(p.x - runningB.x, p.z - runningB.z);
        })
        .toBeGreaterThan(0.5);
    } finally {
      await first.keyboard.up('KeyW');
      await second.keyboard.up('KeyD');
    }
    const stillA = await position(second, idA);
    expect(Math.hypot(stillA.x - pausedA.x, stillA.z - pausedA.z)).toBeLessThan(0.3);
    await first.locator('dialog [data-close]').last().click();
    await second.evaluate(() => {
      const sockets = (window as unknown as { qaSockets: WebSocket[] }).qaSockets;
      sockets.at(-1)!.close(4000, 'QA connection drop');
    });
    await expect(second.locator('[data-reconnect]')).toBeVisible();
    await expect(second.locator('[data-reconnect]')).not.toBeVisible({ timeout: 15_000 });
    await expect(first.locator(`.operator-label[data-player-id="${idB}"]`)).toHaveCount(1);
    expect(await identity(second)).toBe(idB);
    await second.reload();
    await expect(second.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
    expect(await identity(second)).toBe(idB);
    await expect(second.locator('.operator-label')).toHaveCount(2);
    await first.locator('[data-action="pause"]').click();
    await first.locator('dialog [data-action="return-lobby"]').click();
    await expect(first.locator('.field-root')).toHaveAttribute('data-phase', 'LOBBY');
    await expect(second.locator('.field-root')).toHaveAttribute('data-phase', 'LOBBY');
    await leave(second);
    await leave(first);
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
    await independentBrowser.close();
  }
});

test('touch client movement and facing synchronize to an independent desktop client', async ({
  browser,
}) => {
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await testPrefs(mobile);
  await testPrefs(desktop);
  const first = await mobile.newPage(),
    second = await desktop.newPage();
  const errors: string[] = [];
  first.on('pageerror', (e) => errors.push(e.message));
  second.on('pageerror', (e) => errors.push(e.message));
  try {
    await first.goto('/');
    await expect(first.locator('[data-service]')).toHaveClass(/is-available/);
    expect(await first.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await first.screenshot({ path: path.join(qaDir, 'menu-mobile.png') });
    const code = await create(first, 'Touch Alpha');
    await join(second, code, 'Desktop Bravo');
    await first.screenshot({ path: path.join(qaDir, 'lobby-mobile.png') });
    await active(first, second);
    const id = await identity(first),
      original = await position(second, id);
    const stick = await first.locator('[data-stick="move"]').boundingBox();
    expect(stick).not.toBeNull();
    const cdp = await mobile.newCDPSession(first);
    const cx = stick!.x + stick!.width / 2,
      cy = stick!.y + stick!.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: cx, y: cy }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: cx + 34, y: cy }],
    });
    await first.waitForTimeout(650);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => {
        const p = await position(second, id);
        return Math.hypot(p.x - original.x, p.z - original.z);
      })
      .toBeGreaterThan(0.5);
    const face = await first.locator('[data-stick="face"]').boundingBox();
    expect(face).not.toBeNull();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: face!.x + face!.width / 2, y: face!.y + face!.height / 2 }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: face!.x + face!.width / 2 + 30, y: face!.y + face!.height / 2 }],
    });
    await first.waitForTimeout(350);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(async () => (await position(second, id)).yaw).toBeGreaterThan(0.5);
    await first.locator('[data-touch-sprint]').click();
    await expect(first.locator('[data-touch-sprint]')).toHaveAttribute('aria-pressed', 'true');
    await first.screenshot({ path: path.join(qaDir, 'field-mobile.png') });
    await first.setViewportSize({ width: 844, height: 390 });
    await expect(first.locator('[data-stick="move"]')).toBeVisible();
    expect(await first.evaluate(() => document.documentElement.scrollWidth)).toBe(844);
    await first.screenshot({ path: path.join(qaDir, 'field-mobile-landscape.png') });
    await leave(second);
    await leave(first);
    expect(errors).toEqual([]);
  } finally {
    await mobile.close();
    await desktop.close();
  }
});

test('real room-not-found error, server-backed identity persistence and applied graphics settings', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('[data-service]')).toHaveClass(/is-available/);
  await page.locator('[data-action="join"]').click();
  await page.locator('input[name="name"]').fill('Error-Test');
  await page.locator('input[name="code"]').fill('ZZZZZZ');
  await page.locator('[data-submit]').click();
  await expect(page.locator('[data-error]')).toContainText('Room not found');
  const id = await identity(page);
  await page.locator('[data-close]').click();
  await page.reload();
  await expect(page.locator('[data-callsign]')).toHaveText('Error-Test');
  expect(await identity(page)).toBe(id);
  await page.locator('[data-action="settings"]').click();
  await page.locator('select[name="quality"]').selectOption('low');
  await page.locator('select[name="fpsTarget"]').selectOption('30');
  await page.locator('[data-close]').last().click();
  await page.reload();
  await page.locator('[data-action="settings"]').click();
  await expect(page.locator('select[name="quality"]')).toHaveValue('low');
  await expect(page.locator('select[name="fpsTarget"]')).toHaveValue('30');
  await page.locator('[data-close]').last().click();
});

test('network/API failure has an honest unavailable state, not a fake connected lobby', async ({
  page,
}) => {
  await page.route('**/arena/api/**', (route) => route.abort('failed'));
  await page.goto('/');
  await expect(page.locator('[data-service]')).toContainText('ROOM SERVICE UNAVAILABLE');
  await page.locator('[data-action="create"]').click();
  await expect(page.locator('.toast.error').last()).toContainText('unavailable');
  await expect(page.locator('.field-root')).toHaveCount(0);
});
