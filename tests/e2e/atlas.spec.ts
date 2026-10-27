import { expect, test, type Page } from '@playwright/test';

const VEHICLE = 'land-rover-freelander-2-l359-2010-td4';

async function openVehicle(page: Page, query = '') {
  await page.goto(`/v/${VEHICLE}${query}`);
  await page.waitForFunction(() => performance.getEntriesByName('vehicle-ready').length > 0, null, { timeout: 60_000 });
}

test('vehicle search filters by text and model year', async ({ page }) => {
  await page.goto('/');
  const search = page.getByLabel('Search vehicles');
  await search.fill('freelander 2010 diesel');
  await expect(page.locator('.vcard')).toHaveCount(1);
  await expect(page.locator('.vcard h2')).toContainText('Freelander 2');
  await search.fill('freelander 2020');
  await expect(page.locator('.vcard')).toHaveCount(0);
});

test('home: vehicle suggestions open with Enter', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Search vehicles').fill('LR2');
  await expect(page.locator('.suggest-row')).toHaveCount(1);
  await expect(page.locator('.suggest-row')).toContainText('Freelander 2');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/v/${VEHICLE}$`));
});

test('home: the x-ray opens over the car only, and the hero buttons stay clickable', async ({ page }) => {
  await page.goto('/');
  const scanner = page.locator('.scanner');
  // the car's outline comes from the painted render, so wait for it
  await expect.poll(() => page.evaluate(() => document.querySelector<HTMLImageElement>('.scanner-base')?.complete ?? false)).toBe(true);
  // the top-left corner of the picture is empty (the car rises towards the right in this view)
  await scanner.hover({ position: { x: 8, y: 8 } });
  await expect(scanner).not.toHaveClass(/open/);
  await scanner.hover();
  await expect(scanner).toHaveClass(/open/);
  await page.getByRole('button', { name: 'How it is verified' }).click();
  await page.getByRole('button', { name: /Open the Freelander 2 in 3D/ }).click();
  await expect(page).toHaveURL(new RegExp(`/v/${VEHICLE}$`));
});

test('home: a part marked on the x-ray hero opens in 3D', async ({ page }) => {
  await page.goto('/');
  const scanner = page.locator('.scanner');
  await scanner.hover();
  await expect(scanner).toHaveClass(/open/);
  const spot = scanner.locator('.spot').first();
  const name = await spot.getAttribute('title');
  await spot.click();
  await expect(page).toHaveURL(new RegExp(`/v/${VEHICLE}\\?part=`));
  await page.waitForFunction(() => performance.getEntriesByName('vehicle-ready').length > 0, null, { timeout: 60_000 });
  await expect(page.locator('.part-title')).toHaveText(name!);
});

test('loads the vehicle and finds parts by mechanic terms', async ({ page }) => {
  await openVehicle(page);
  await expect(page.locator('.rail-btn')).toHaveCount(12); // 11 systems + "All"
  await expect(page.getByTestId('perf')).toContainText('ready in');

  await page.getByLabel('Search components').fill('fuse box');
  const results = page.locator('.search-results .r-name');
  await expect(results.first()).toBeVisible();
  const names = await results.allTextContents();
  expect(names.slice(0, 4).join(' | ')).toMatch(/junction box/i);

  await page.getByLabel('Search components').fill('battery junction');
  await page.keyboard.press('Enter');
  await expect(page.locator('.part-title')).toHaveText('Battery junction box (BJB)');
  await expect(page).toHaveURL(/part=bjb/);
  await expect(page.locator('.panel-body')).toContainText('Remove or move first');
});

test('deep link selects a component', async ({ page }) => {
  await openVehicle(page, '?part=battery');
  await expect(page.locator('.part-title')).toHaveText('Battery (12 V)');
  await expect(page.locator('.panel-body')).toContainText('Exide H7');
});

test('breaking down an on-demand assembly loads its detail chunk', async ({ page }) => {
  await openVehicle(page);
  const detail = page.waitForResponse((r) => /detail-front-caliper-l\./.test(r.url()));
  await page.getByLabel('Search components').fill('front brake caliper');
  await page.keyboard.press('Enter');
  await expect(page.locator('.part-title')).toHaveText('Front brake caliper (single piston, sliding) (LH)');
  await page.keyboard.press('b');
  expect((await detail).ok()).toBeTruthy();
  for (const part of ['Sliding caliper housing (LH)', 'Inner brake pad and anti-squeal shim (LH)', 'Fixed carrier (LH)', 'Bleed screw (LH)']) await expect(page.locator('.panel-body')).toContainText(part);
  await expect(page.locator('.panel-body')).toContainText('60 mm');
  await expect(page.getByRole('button', { name: 'Collapse' })).toBeVisible();
});

test('explode and verification colour mode', async ({ page }) => {
  await openVehicle(page);
  await page.getByRole('button', { name: 'Exploded' }).click();
  await expect(page.locator('.tools .kbd').first()).toHaveText('100%');
  await page.getByRole('button', { name: 'Colours' }).click();
  await page.getByRole('button', { name: 'Verified' }).click();
  await expect(page.getByRole('button', { name: 'Verified' })).toHaveClass(/on/);
});

test('wiring: connector pin-outs and circuit highlighting come from the OEM diagrams', async ({ page }) => {
  await openVehicle(page, '?part=ecm');
  await expect(page.locator('.part-title')).toHaveText('Engine control module (ECM)');
  await expect(page.locator('.panel-body')).toContainText('Engine control-module (ECM)');
  await expect(page.locator('.panel-body')).toContainText('C1E109A');
  await expect(page.locator('.panel-body .wire-row').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Wiring' }).click();
  await page.getByLabel('Filter circuits').fill('Diesel');
  await page.locator('.list-item', { hasText: 'sheet 01/05' }).first().click();
  await expect(page.locator('.panel-body .card').first()).toContainText('Battery');
});

test('wires are drawn in 3D for a part and for a circuit sheet', async ({ page }) => {
  const drawn = () => page.evaluate(() => (window as unknown as { __viewer: { wires: { count: number } } }).__viewer.wires.count);
  await openVehicle(page, '?part=cjb');
  await expect(page.locator('.part-title')).toHaveText(/Central junction box/);
  await expect(page.getByRole('button', { name: 'Wires shown in 3D' })).toBeVisible();
  await expect.poll(drawn).toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Wires shown in 3D' }).click();
  await expect.poll(drawn).toBe(0);
  await page.getByRole('button', { name: 'Show wires in 3D' }).click();
  await expect.poll(drawn).toBeGreaterThan(20);

  await page.getByRole('tab', { name: 'Wiring' }).click();
  await page.getByLabel('Filter circuits').fill('EXTERIOR LIGHTING');
  await page.locator('.list-item', { hasText: 'sheet 01/04' }).first().click();
  await expect(page.locator('.panel-body')).toContainText('drawn along the harness routes');
  await expect.poll(drawn).toBeGreaterThan(10);
});

test('wiring by year: switching publication changes the circuits shown', async ({ page }) => {
  await openVehicle(page);
  await page.getByRole('tab', { name: 'Wiring' }).click();
  const picker = page.locator('.pubs');
  await expect(picker).toContainText('used for this car');
  await expect(picker).toContainText('VIN 000201–057871');
  await expect(page.locator('.panel-body')).toContainText('303-14');
  await picker.getByRole('button', { name: /engineering issue/ }).click();
  await expect(page.locator('.panel-body')).toContainText('ENGINE MANAGEMENT DIESEL CIRCUIT');
  await picker.locator('.pub-diff').last().click();
  await expect(picker.locator('.changes')).toContainText('Connections:');
});

test('second vehicle: the Galaxy loads with its VW wiring by build date', async ({ page }) => {
  await page.goto('/v/ford-galaxy-wgr-1998-19tdi?part=abs-control-unit');
  await page.waitForFunction(() => performance.getEntriesByName('vehicle-ready').length > 0, null, { timeout: 60_000 });
  await expect(page.locator('.rail-btn')).toHaveCount(12); // 11 systems + "All"
  await expect(page.locator('.part-title')).toHaveText('ABS control unit');
  // the control unit's own 25-pin plug from the ABS diagram (VW codes are scoped per diagram)
  await expect(page.locator('.panel-body')).toContainText('T25.20');
  await expect(page.locator('.panel-body .wire-row').first()).toBeVisible();

  await expect(page.locator('.panel-body')).toContainText('Ford parts catalogue');

  await page.getByLabel('Search components').fill('glow plug');
  await expect(page.locator('.search-results .r-name').first()).toHaveText('Glow plug 1');
  await page.keyboard.press('Escape');

  await page.getByRole('tab', { name: 'Wiring' }).click();
  const picker = page.locator('.pubs');
  await expect(picker).toContainText('Built January–April 1998');
  await picker.getByRole('button', { name: /Built September–December 1997/ }).click();
  await expect(page.locator('.panel-body')).toContainText('No. 9');
});

test('connected-to lists documented joints and wired parts', async ({ page }) => {
  await openVehicle(page, '?part=front-knuckle-l');
  const panel = page.locator('.panel-body');
  await expect(panel).toContainText('Connected to');
  await expect(panel.locator('.link-row', { hasText: 'Fixed carrier' })).toContainText('200 Nm (new)');
  await expect(panel.locator('.link-row', { hasText: 'Fixed carrier' })).toContainText('p. 258');
  await panel.locator('.link-row', { hasText: 'Tie rod' }).getByRole('button').click();
  await expect(page.locator('.part-title')).toHaveText('Tie rod and tie-rod end (LH)');

  await page.goto(`/v/${VEHICLE}?part=ecm`);
  await page.waitForFunction(() => performance.getEntriesByName('vehicle-ready').length > 0, null, { timeout: 60_000 });
  await expect(page.locator('.panel-body')).toContainText('Wired to');
  await expect(page.locator('.panel-body .list-item', { hasText: 'Fuel injector, cylinder 1' })).toBeVisible();
});

test('verification report lists every component with its facets', async ({ page }) => {
  await page.goto(`/v/${VEHICLE}/verification`);
  await expect(page.locator('h1')).toContainText('Verification report');
  expect(await page.locator('tbody tr').count()).toBeGreaterThan(300);
  await page.getByLabel('Filter components').fill('turbo');
  await expect(page.locator('tbody tr').first()).toContainText(/turbo/i);
  for (const row of await page.locator('tbody tr').allTextContents()) expect(row).toMatch(/turbo/i);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the panel is a bottom sheet: search opens it, a picked part shows at half height', async ({ page }) => {
    const sheet = () => page.evaluate(() => (window as unknown as { __store: { getState(): { sheet: string } } }).__store.getState().sheet);
    await openVehicle(page);
    await expect(page.locator('.panel.sheet')).toBeVisible();
    expect(await sheet()).toBe('peek');
    await page.getByLabel('Search components').fill('battery junction');
    expect(await sheet()).toBe('full');
    await page.keyboard.press('Enter');
    await expect(page.locator('.part-title')).toHaveText('Battery junction box (BJB)');
    await expect.poll(sheet).toBe('half');
    await page.locator('.sheet-grip').tap();
    await expect.poll(sheet).toBe('peek');
  });
});

test('renders smoothly while orbiting (GPU only)', async ({ page }) => {
  test.skip(process.env.E2E_GPU !== '1', 'frame-rate check needs a real GPU (set E2E_GPU=1)');
  await openVehicle(page);
  const fps = await page.evaluate(async () => {
    const v = (window as unknown as { __viewer: { camera: import('three').PerspectiveCamera; controls: { target: import('three').Vector3 }; invalidate(): void } }).__viewer;
    const t = v.controls.target.clone();
    const r = Math.hypot(v.camera.position.x - t.x, v.camera.position.z - t.z);
    let frames = 0;
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = (now: number) => {
        const a = (now - t0) / 1000;
        v.camera.position.set(t.x + Math.sin(a) * r, v.camera.position.y, t.z + Math.cos(a) * r);
        v.camera.lookAt(t);
        v.invalidate();
        frames++;
        if (now - t0 < 3000) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    return (frames * 1000) / (performance.now() - t0);
  });
  expect(fps).toBeGreaterThan(45);
});
