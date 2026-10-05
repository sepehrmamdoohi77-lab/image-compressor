import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const qa = path.resolve('../.arena/qa');
fs.mkdirSync(qa, { recursive: true });
async function preferences(context: BrowserContext) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem(
        'tactical-arena.settings.v1',
        JSON.stringify({
          version: 2,
          quality: 'low',
          zoom: 11,
          rotationSpeed: 1,
          touchScale: 1,
          gamepadDeadzone: 0.18,
          fpsTarget: 30,
          masterVolume: 0,
          sfxVolume: 0,
          musicVolume: 0,
        }),
      );
    } catch {
      /* First about:blank has no storage origin. */
    }
  });
}
interface Grenade {
  id: string;
  ownerId: string;
  x: number;
  y: number;
  z: number;
  target: { x: number; y: number; z: number } | null;
  landed: boolean;
  blocked: boolean;
}
function observe(page: Page) {
  const state = {
    room: null as null | { mapId: string; settings: { mapId: string }; phase: string },
    own: null as null | { id: string; x: number; z: number; combat: { health: number } },
    command: null as null | { targetX: number; targetZ: number },
    landed: [] as Grenade[],
    errors: [] as string[],
  };
  page.on('pageerror', (e) => state.errors.push(e.message));
  page.on('websocket', (ws) => {
    ws.on('framereceived', (frame) => {
      try {
        const msg = JSON.parse(String(frame.payload));
        if (msg.type === 'room_state') state.room = msg.room;
        if (msg.type === 'snapshot') {
          const own = msg.players.find((p: { id: string }) => p.id === state.own?.id);
          if (own) state.own = own;
          state.landed.push(...msg.grenades.filter((g: Grenade) => g.landed));
        }
      } catch {
        /* No raw proof or credentials are recorded. */
      }
    });
    ws.on('framesent', (frame) => {
      try {
        const msg = JSON.parse(String(frame.payload));
        if (msg.type === 'grenade') state.command = { targetX: msg.targetX, targetZ: msg.targetZ };
      } catch {
        /* No raw proof or credentials are recorded. */
      }
    });
  });
  return state;
}
async function leave(page: Page) {
  await page.locator('[data-action="pause"]').click();
  await page.locator('dialog [data-action="leave"]').click();
  await page.locator('[data-action="confirm-leave"]').click();
  await expect(page.locator('.operations-screen')).toBeVisible();
}

test('all ten physical map previews are selectable; two independent clients render the same chosen real room', async ({
  browser,
}) => {
  const a = await browser.newContext({ viewport: { width: 1100, height: 800 } }),
    b = await browser.newContext({ viewport: { width: 1000, height: 750 } });
  await preferences(a);
  await preferences(b);
  const first = await a.newPage(),
    second = await b.newPage(),
    authorityA = observe(first),
    authorityB = observe(second);
  try {
    await first.goto('/');
    await expect(first.locator('[data-service]')).toHaveClass(/is-available/);
    await first.locator('[data-action="create"]').click();
    const select = first.locator('select[name="mapId"]');
    await expect(select.locator('option')).toHaveCount(10);
    const options = await select
        .locator('option')
        .evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value)),
      previews = new Set<string>();
    for (const id of options) {
      await select.selectOption(id);
      previews.add(await first.locator('[data-map-summary] svg.map-view').innerHTML());
    }
    expect(previews.size).toBe(10);
    await select.selectOption('market');
    await expect(first.locator('[data-map-summary]')).toContainText('MARKET');
    await first.screenshot({ path: path.join(qa, 'map-selection-market.png') });
    await first.locator('input[name="name"]').fill('Map Browser Alpha');
    await first.locator('select[name="mode"]').selectOption('NETWORK_DRILL');
    await first.locator('select[name="teamSize"]').selectOption('1');
    await first.locator('[data-submit]').click();
    await expect(first.locator('.field-root')).toHaveAttribute('data-map-id', 'market');
    await expect(first.locator('.arena-canvas')).toHaveAttribute(
      'aria-label',
      'Live 3D MARKET multiplayer field',
    );
    const code = await first.locator('strong[data-room-code]').textContent();
    await second.goto('/');
    await second.locator('[data-action="join"]').click();
    await second.locator('input[name="name"]').fill('Map Browser Bravo');
    await second.locator('input[name="code"]').fill(code!);
    await second.locator('[data-submit]').click();
    await expect(second.locator('.field-root')).toHaveAttribute('data-map-id', 'market');
    await expect(second.locator('.arena-canvas')).toHaveAttribute(
      'aria-label',
      'Live 3D MARKET multiplayer field',
    );
    await expect.poll(() => authorityA.room?.mapId).toBe('market');
    await expect.poll(() => authorityB.room?.settings.mapId).toBe('market');
    await first.locator('[data-ready]').click();
    await second.locator('[data-ready]').click();
    await first.locator('[data-start]').click();
    await expect(second.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
    await first.screenshot({ path: path.join(qa, 'market-multiplayer.png') });
    await leave(second);
    await leave(first);
    expect(authorityA.errors).toEqual([]);
    expect(authorityB.errors).toEqual([]);
  } finally {
    await a.close();
    await b.close();
  }
});

test('public Quick Play sends the selected map to actual human-only matching', async ({
  page,
  context,
}) => {
  await preferences(context);
  const state = observe(page);
  await page.goto('/');
  await page.locator('[data-action="quick-play"]').click();
  await expect(page.locator('select[name="mapId"] option')).toHaveCount(10);
  await page.locator('select[name="mapId"]').selectOption('bunker');
  await page.locator('input[name="name"]').fill('Map Quick Operator');
  await page.locator('[data-submit]').click();
  await expect(page.locator('.field-root')).toHaveAttribute('data-map-id', 'bunker');
  await expect.poll(() => state.room?.mapId).toBe('bunker');
  await expect(page.locator('.arena-canvas')).toHaveAttribute(
    'aria-label',
    'Live 3D BUNKER multiplayer field',
  );
  await expect(page.locator('[data-lobby-mode]')).toHaveText('PUBLIC QUICK PLAY');
  await leave(page);
  expect(state.errors).toEqual([]);
});

test('real mouse targeting previews the arc and the authoritative grenade actually lands at that cursor target', async ({
  page,
  context,
}) => {
  await preferences(context);
  const state = observe(page);
  await page.goto('/');
  await page.locator('[data-action="create"]').click();
  await page.locator('input[name="name"]').fill('Cursor Grenadier');
  await page.locator('select[name="mapId"]').selectOption('courtyard');
  await page.locator('select[name="teamSize"]').selectOption('1');
  await page.locator('select[name="bots"]').selectOption('1');
  await page.locator('select[name="difficulty"]').selectOption('easy');
  await page.locator('[data-submit]').click();
  await expect(page.locator('dialog')).not.toBeVisible();
  const session = await (await page.request.get('/arena/api/session')).json();
  state.own = { id: session.profile.id, x: -4, z: 18, combat: { health: 100 } };
  await page.locator('[data-ready]').click();
  await page.locator('[data-start]').click();
  await expect(page.locator('.field-root')).toHaveAttribute('data-phase', 'ACTIVE');
  await expect(page.locator('.arena-canvas')).toBeVisible();
  await page.waitForTimeout(1800);
  // Project an open staging-ground waypoint through the actual public camera
  // class; the only action performed is a normal mouse move and G key press.
  const cursor = await page.evaluate(async () => {
    const { TacticalCamera } = await import('/src/game/TacticalCamera.ts');
    const rect = document.querySelector('.arena-canvas')!.getBoundingClientRect(),
      camera = new TacticalCamera();
    camera.overview = false;
    camera.zoom = 11;
    camera.resize(rect.width, rect.height);
    camera.update(camera.camera.position.clone().set(-4, 0, 18), 1);
    camera.camera.updateMatrixWorld(true);
    const point = camera.camera.position.clone().set(6, 0, 18).project(camera.camera);
    return {
      x: rect.left + ((point.x + 1) * rect.width) / 2,
      y: rect.top + ((1 - point.y) * rect.height) / 2,
    };
  });
  await page.mouse.move(cursor.x, cursor.y);
  await expect(page.locator('[data-grenade-target]')).toContainText('CLEAR LANDING');
  await page.screenshot({ path: path.join(qa, 'grenade-cursor-preview.png') });
  await page.keyboard.press('KeyG');
  await expect(page.locator('[data-grenades]')).toHaveText('1');
  await expect.poll(() => state.landed.length, { timeout: 4000 }).toBeGreaterThan(0);
  const command = state.command!,
    grenade = state.landed.find((g) => g.ownerId === state.own!.id)!;
  expect(Number.isFinite(command.targetX) && Number.isFinite(command.targetZ)).toBe(true);
  expect(grenade.blocked).toBe(false);
  expect(grenade.target!.x).toBe(command.targetX);
  expect(grenade.target!.z).toBe(command.targetZ);
  expect(Math.hypot(grenade.x - command.targetX, grenade.z - command.targetZ)).toBeLessThan(0.035);
  expect(grenade.y).toBe(0.09);
  await page.screenshot({ path: path.join(qa, 'grenade-mouse-landing.png') });
  await leave(page);
  expect(state.errors).toEqual([]);
});
