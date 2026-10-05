import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const qa = path.resolve('../.arena/qa');
fs.mkdirSync(qa, { recursive: true });
const launch = {
  executablePath: process.env.ARENA_CHROMIUM_PATH,
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
};
async function preferences(context: BrowserContext) {
  await context.addInitScript(() =>
    localStorage.setItem(
      'tactical-arena.settings.v1',
      JSON.stringify({
        version: 2,
        quality: 'low',
        zoom: 14,
        rotationSpeed: 1,
        touchScale: 1,
        gamepadDeadzone: 0.18,
        fpsTarget: 30,
        masterVolume: 0,
        sfxVolume: 0,
        musicVolume: 0,
      }),
    ),
  );
}
const received = new WeakMap<
  Page,
  {
    players: Map<string, { x: number; z: number }>;
    input: unknown;
    fires: unknown[];
    events: unknown[];
  }
>();
function observeAuthority(page: Page) {
  const state = {
    players: new Map<string, { x: number; z: number }>(),
    input: null as unknown,
    fires: [] as unknown[],
    events: [] as unknown[],
  };
  received.set(page, state);
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      try {
        const value = JSON.parse(String(frame.payload));
        if (value.type === 'combat_event') state.events.push(value.event);
        if (value.type === 'snapshot')
          for (const p of value.players) state.players.set(p.id, { x: p.x, z: p.z });
      } catch {
        /* Assertions handle missing valid snapshots. */
      }
    });
    ws.on('framesent', (frame) => {
      try {
        const value = JSON.parse(String(frame.payload));
        if (value.type === 'input') {
          state.input = { moveX: value.moveX, moveZ: value.moveZ, seq: value.seq };
          if (value.trigger)
            state.fires.push({
              seq: value.seq,
              aim: value.aim,
              pitch: value.pitch,
              ads: value.ads,
              trigger: value.trigger,
            });
        }
      } catch {
        /* Never record guest proof frames or credentials. */
      }
    });
  });
}
async function position(page: Page, id: string) {
  const authoritative = received.get(page)?.players.get(id);
  if (authoritative) return authoritative;
  return page.locator(`.operator-label[data-player-id="${id}"]`).evaluate((el) => ({
    x: Number((el as HTMLElement).dataset.x),
    z: Number((el as HTMLElement).dataset.z),
  }));
}
async function walk(page: Page, id: string, x: number, z: number) {
  const keys = new Set<string>();
  const vectors = [
    ['KeyW', 0, -1],
    ['KeyS', 0, 1],
    ['KeyA', -1, 0],
    ['KeyD', 1, 0],
    ['KeyW,KeyD', 1, -1],
    ['KeyW,KeyA', -1, -1],
    ['KeyS,KeyA', -1, 1],
    ['KeyS,KeyD', 1, 1],
  ] as const;
  const start = Date.now();
  try {
    while (Date.now() - start < 35000) {
      const p = await position(page, id);
      const dx = x - p.x,
        dz = z - p.z,
        len = Math.hypot(dx, dz);
      if (len < 0.35) return;
      const sx = Math.cos(0.6) * dx - Math.sin(0.6) * dz,
        sy = Math.sin(0.6) * dx + Math.cos(0.6) * dz;
      const choice = [...vectors].sort(
        (a, b) =>
          (b[1] * sx + b[2] * sy) / Math.hypot(b[1], b[2]) -
          (a[1] * sx + a[2] * sy) / Math.hypot(a[1], a[2]),
      )[0]!;
      const next = new Set(choice[0].split(','));
      for (const key of keys)
        if (!next.has(key)) {
          await page.keyboard.up(key);
          keys.delete(key);
        }
      // Independent headless windows may emit blur while the other client is
      // driven. Reassert real held-key events instead of trusting this harness's
      // key set after the game's deliberate blur reset. No state is teleported.
      for (const key of next) {
        await page.keyboard.down(key);
        keys.add(key);
      }
      await page.waitForTimeout(90);
    }
    throw new Error(
      `Keyboard did not reach ${x},${z}; ${JSON.stringify(await position(page, id))}; intent=${JSON.stringify(received.get(page)?.input)}`,
    );
  } finally {
    for (const k of keys) await page.keyboard.up(k);
  }
}
async function lane(page: Page, id: string, targetZ: number) {
  const start = (await position(page, id)).z;
  const sign = Math.sign(targetZ - start);
  let z = start;
  while (Math.abs(targetZ - z) > 1.1) {
    z += sign * 1.1;
    await walk(page, id, -10.6, z);
  }
  await walk(page, id, -10.6, targetZ);
}
async function leave(page: Page) {
  if (await page.locator('dialog').isVisible()) await page.locator('[data-close]').last().click();
  await page.locator('[data-action="pause"]').click();
  await page.locator('dialog [data-action="leave"]').click();
  await page.locator('[data-action="confirm-leave"]').click();
  await expect(page.locator('.operations-screen')).toBeVisible();
}

test('two actual browsers shoot with real input, health/death/score/results and stored XP synchronize', async ({
  browser,
}) => {
  const other = await browser.browserType().launch(launch);
  const a = await browser.newContext({ viewport: { width: 900, height: 650 } }),
    b = await other.newContext({ viewport: { width: 900, height: 650 } });
  await preferences(a);
  await preferences(b);
  const first = await a.newPage(),
    second = await b.newPage();
  observeAuthority(first);
  observeAuthority(second);
  const errors: string[] = [];
  for (const p of [first, second]) {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
  }
  try {
    await first.goto('/');
    await expect(first.locator('[data-service]')).toHaveClass(/is-available/);
    await first.locator('[data-action="callsign"]').click();
    await first.locator('input[name="name"]').fill('Browser Alpha');
    await first.locator('[data-submit]').click();
    await expect(first.locator('dialog')).not.toBeVisible();
    await first.locator('[data-action="loadout"]').first().click();
    await first.locator('input[name="primary"][value="dmr"]').check();
    await first.locator('[data-submit]').click();
    await expect(first.locator('dialog')).not.toBeVisible();
    await first.locator('[data-action="create"]').click();
    await first.locator('select[name="teamSize"]').selectOption('1');
    await first.locator('select[name="scoreLimit"]').selectOption('10');
    await first.locator('[data-submit]').click();
    await expect(first.locator('.field-root')).toHaveAttribute('data-phase', 'LOBBY');
    await expect(first.locator('dialog')).not.toBeVisible();
    const code = await first.locator('strong[data-room-code]').textContent();
    // Private score 10 stays active through the first kill, allowing respawn/reload QA.
    await second.goto('/');
    await second.locator('[data-action="join"]').click();
    await second.locator('input[name="name"]').fill('Browser Bravo');
    await second.locator('input[name="code"]').fill(code!);
    await second.locator('[data-submit]').click();
    await expect(second.locator('dialog')).not.toBeVisible();
    const idA = (await (await first.request.get('/arena/api/session')).json()).profile.id,
      idB = (await (await second.request.get('/arena/api/session')).json()).profile.id;
    await first.locator('[data-ready]').click();
    await second.locator('[data-ready]').click();
    await first.locator('[data-start]').click();
    await expect(first.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
    await expect(second.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
    await expect(first.locator('[data-health]')).toHaveText('100');
    await expect(first.locator('[data-weapon-label]')).toHaveText('DMR-7');
    await expect(first.locator('[data-magazine]')).toHaveText('12');
    await first.locator('.arena-canvas').click({ position: { x: 400, y: 300 } });
    await second.locator('.arena-canvas').click({ position: { x: 400, y: 300 } });
    await Promise.all([walk(first, idA, -10.6, 18), walk(second, idB, -10.6, -18)]);
    await Promise.all([lane(first, idA, 0), lane(second, idB, -4)]);
    await expect(first.locator(`.operator-label[data-player-id="${idB}"]`)).toBeVisible();
    await first.screenshot({ path: path.join(qa, 'combat-browsers.png') });
    await first.bringToFront();
    let killed = false;
    const clickTargets: unknown[] = [];
    for (let i = 0; i < 8; i++) {
      const target = await first.locator(`.operator-label[data-player-id="${idB}"]`).boundingBox();
      if (!target) break;
      clickTargets.push(
        await first.evaluate(
          ({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            return { x, y, tag: el?.tagName, class: el?.className };
          },
          { x: target.x + target.width / 2, y: target.y + target.height + 8 },
        ),
      );
      await first.mouse.move(target.x + target.width / 2, target.y + target.height + 8);
      if (i === 0) await first.mouse.down({ button: 'right' });
      await first.waitForTimeout(350);
      await first.mouse.click(target.x + target.width / 2, target.y + target.height + 8);
      await first.waitForTimeout(650);
      killed = Number(await second.locator('[data-health]').textContent()) === 0;
      if (killed) break;
    }
    await first.mouse.up({ button: 'right' });
    if (!killed)
      fs.writeFileSync(
        path.join(qa, 'combat-aim-diagnostic.json'),
        JSON.stringify(
          {
            clickTargets,
            fires: received.get(first)?.fires,
            events: received.get(first)?.events,
            positions: [...received.get(first)!.players.values()],
            magazine: await first.locator('[data-magazine]').textContent(),
            health: await second.locator('[data-health]').textContent(),
          },
          null,
          2,
        ),
      );
    expect(killed).toBe(true);
    await expect(second.locator('[data-death]')).toBeVisible();
    await expect(first.locator('[data-blue-count]')).toHaveText('1');
    await expect(second.locator('[data-blue-count]')).toHaveText('1');
    await expect(first.locator('[data-killfeed]')).toContainText('Browser Bravo');
    await expect(second.locator('[data-health]')).toHaveText('100', { timeout: 10000 });
    await expect(second.locator('[data-death]')).not.toBeVisible();
    await first.keyboard.press('KeyR');
    await expect(first.locator('[data-weapon-state]')).toHaveText('RELOADING');
    const before = Number(await first.locator('[data-magazine]').textContent());
    expect(before).toBeLessThan(12);
    await expect(first.locator('[data-magazine]')).toHaveText('12');
    await first.keyboard.press('Digit2');
    await expect(first.locator('[data-weapon-label]')).toHaveText('P-9');
    await first.keyboard.press('Digit1');
    await expect(first.locator('[data-weapon-label]')).toHaveText('DMR-7');
    // Aborting is explicitly confirmed and cannot invent progression.
    await first.locator('[data-action="pause"]').click();
    await first.locator('dialog [data-action="return-lobby"]').click();
    await first.locator('[data-action="confirm-return-lobby"]').click();
    await expect(first.locator('.field-root')).toHaveAttribute('data-phase', 'LOBBY');
    const profile = (await (await first.request.get('/arena/api/session')).json()).profile;
    expect(profile.stats.matches).toBe(0);
    expect(profile.xp).toBe(0);
    await leave(second);
    await leave(first);
    expect(errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
    await other.close();
  }
});

test('explicit solo bot practice is playable and never claims human opponents or XP', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('[data-service]')).toHaveClass(/is-available/);
  await page.locator('[data-action="create"]').click();
  await page.locator('input[name="name"]').fill('Solo Practice');
  await page.locator('select[name="teamSize"]').selectOption('1');
  await page.locator('select[name="bots"]').selectOption('1');
  await page.locator('select[name="difficulty"]').selectOption('easy');
  await page.locator('[data-submit]').click();
  await expect(page.locator('dialog')).not.toBeVisible();
  await expect(page.locator('[data-teams]')).toContainText('BOT Viper');
  await expect(page.locator('[data-mode-note]')).toContainText('No XP');
  await page.locator('[data-ready]').click();
  await expect(page.locator('[data-start]')).toBeEnabled();
  await page.locator('[data-start]').click();
  await expect(page.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
  await expect(page.locator('[data-health]')).toHaveText('100');
  const start = (await (await page.request.get('/arena/api/session')).json()).profile;
  await expect(page.locator('[data-field-note]')).toContainText('PROGRESSION OFF');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(qa, 'practice-live.png') });
  expect((await (await page.request.get('/arena/api/session')).json()).profile.xp).toBe(start.xp);
  await leave(page);
  expect(errors).toEqual([]);
});

test('a completed private duel shows real victory and committed XP/profile/history', async ({
  browser,
}) => {
  const other = await browser.browserType().launch(launch);
  const ac = await browser.newContext({ viewport: { width: 900, height: 650 } }),
    bc = await other.newContext({ viewport: { width: 900, height: 650 } });
  await preferences(ac);
  await preferences(bc);
  const a = await ac.newPage(),
    b = await bc.newPage();
  observeAuthority(a);
  observeAuthority(b);
  const errors: string[] = [];
  a.on('pageerror', (e) => errors.push(e.message));
  b.on('pageerror', (e) => errors.push(e.message));
  try {
    await a.goto('/');
    await a.locator('[data-action="callsign"]').click();
    await a.locator('input[name="name"]').fill('Duel Alpha');
    await a.locator('[data-submit]').click();
    await expect(a.locator('dialog')).not.toBeVisible();
    await a.locator('[data-action="loadout"]').first().click();
    await a.locator('input[name="primary"][value="dmr"]').check();
    await a.locator('[data-submit]').click();
    await expect(a.locator('dialog')).not.toBeVisible();
    await a.locator('[data-action="create"]').click();
    await a.locator('select[name="teamSize"]').selectOption('1');
    await a.locator('select[name="scoreLimit"]').selectOption('1');
    await a.locator('[data-submit]').click();
    await expect(a.locator('dialog')).not.toBeVisible();
    const code = await a.locator('strong[data-room-code]').textContent();
    await b.goto('/');
    await b.locator('[data-action="join"]').click();
    await b.locator('input[name="name"]').fill('Duel Bravo');
    await b.locator('input[name="code"]').fill(code!);
    await b.locator('[data-submit]').click();
    await expect(b.locator('dialog')).not.toBeVisible();
    const idA = (await (await a.request.get('/arena/api/session')).json()).profile.id,
      idB = (await (await b.request.get('/arena/api/session')).json()).profile.id;
    await a.locator('[data-ready]').click();
    await b.locator('[data-ready]').click();
    await a.locator('[data-start]').click();
    await expect(a.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
    await expect(b.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
    await a.locator('.arena-canvas').click({ position: { x: 400, y: 300 } });
    await b.locator('.arena-canvas').click({ position: { x: 400, y: 300 } });
    await Promise.all([walk(a, idA, -10.6, 18), walk(b, idB, -10.6, -18)]);
    await Promise.all([lane(a, idA, 0), lane(b, idB, -4)]);
    await a.bringToFront();
    await expect(a.locator(`.operator-label[data-player-id="${idB}"]`)).toBeVisible();
    for (let i = 0; i < 5; i++) {
      if (await a.locator('[data-results]').isVisible()) break;
      const box = await a.locator(`.operator-label[data-player-id="${idB}"]`).boundingBox();
      if (!box) break;
      await a.mouse.move(box.x + box.width / 2, box.y + box.height + 8);
      if (i === 0) await a.mouse.down({ button: 'right' });
      await a.waitForTimeout(350);
      await a.mouse.click(box.x + box.width / 2, box.y + box.height + 8);
      await a.waitForTimeout(650);
    }
    await a.mouse.up({ button: 'right' });
    await expect(a.locator('[data-results]')).toBeVisible();
    await expect(b.locator('[data-results]')).toBeVisible();
    await expect(a.locator('[data-results]')).toContainText('VICTORY');
    await expect(b.locator('[data-results]')).toContainText('DEFEAT');
    await expect(a.locator('.result-reward')).toContainText('XP RECORDED');
    const p = (await (await a.request.get('/arena/api/session')).json()).profile;
    expect(p.stats.matches).toBe(1);
    expect(p.stats.wins).toBe(1);
    expect(p.stats.kills).toBe(1);
    expect(p.xp).toBeGreaterThanOrEqual(275);
    expect(p.history).toHaveLength(1);
    await a.screenshot({ path: path.join(qa, 'victory-results.png') });
    await leave(b);
    await leave(a);
    await a.locator('[data-action="profile"]').click();
    await expect(a.locator('dialog')).toContainText('OPERATOR DOSSIER');
    // History uses the persisted win label, not an invented leaderboard entry.
    await expect(a.locator('.match-history')).toContainText('WIN');
    expect(errors).toEqual([]);
  } finally {
    await ac.close();
    await bc.close();
    await other.close();
  }
});

test('touch fire, timed reload, ADS and grenade controls use real server inventory', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  await preferences(context);
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto('/');
    await page.locator('[data-action="create"]').click();
    await page.locator('input[name="name"]').fill('Touch Combat');
    await page.locator('select[name="teamSize"]').selectOption('1');
    await page.locator('select[name="bots"]').selectOption('1');
    await page.locator('select[name="difficulty"]').selectOption('easy');
    await page.locator('[data-submit]').click();
    await expect(page.locator('dialog')).not.toBeVisible();
    await page.locator('[data-ready]').click();
    await page.locator('[data-start]').click();
    await expect(page.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
    await expect(page.locator('[data-magazine]')).toHaveText('30');
    const button = await page.locator('[data-touch-fire]').boundingBox();
    expect(button).not.toBeNull();
    expect(button!.width).toBeGreaterThanOrEqual(44);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: button!.x + button!.width / 2, y: button!.y + button!.height / 2 }],
    });
    await page.waitForTimeout(500);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect
      .poll(async () => Number(await page.locator('[data-magazine]').textContent()))
      .toBeLessThan(30);
    await page.locator('[data-action="reload"][data-touch-combat]').click();
    await expect(page.locator('[data-weapon-state]')).toHaveText('RELOADING');
    await expect(page.locator('[data-magazine]')).toHaveText('30');
    await page.locator('[data-touch-ads]').click();
    await expect(page.locator('[data-touch-ads]')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('[data-action="grenade"][data-touch-combat]').click();
    await expect(page.locator('[data-grenades]')).toHaveText('1');
    await page.screenshot({ path: path.join(qa, 'combat-touch-portrait.png') });
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.locator('[data-touch-fire]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(844);
    await page.screenshot({ path: path.join(qa, 'combat-touch-landscape.png') });
    await leave(page);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
