import { expect, type Page, test } from '@playwright/test';

const errors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  // The live map's tiles come from maps.ride-on.cc; keep the tests off the network.
  await page.route('https://maps.ride-on.cc/**', (route) => route.abort());
  const pageErrors: string[] = [];
  errors.set(page, pageErrors);
  page.on('pageerror', (error) => pageErrors.push(error.message));
});

test.afterEach(({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

/** Scrolls to the bottom half a screen at a time, so every reveal and island runs. Instant, not the
 * page's smooth scrolling: each smooth scroll cuts off the last, and on a slow runner one dropped
 * frame can carry it past a whole section before its observer sees it. */
const scrollThrough = (page: Page) =>
  page.evaluate(async () => {
    const frame = () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    for (let y = 0; y < document.body.scrollHeight; y += innerHeight / 2) {
      scrollTo({ top: y, behavior: 'instant' });
      await frame();
    }
  });

/** Waits for the React island holding `selector` to hydrate. */
const hydrated = (page: Page, selector: string) =>
  expect(page.locator(`astro-island:has(${selector})`)).not.toHaveAttribute(
    'ssr',
  );

for (const colorScheme of ['light', 'dark'] as const) {
  test(`renders in ${colorScheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto('/');
    await expect(page).toHaveTitle('Ride On: pick the right ride');
    await expect(page.getByRole('heading', { level: 1 })).toContainText(
      'Ride on',
    );
    await scrollThrough(page);
    await expect(page.locator('astro-island[ssr]')).toHaveCount(0);
    await expect(page.locator('[data-rv]:not([data-seen])')).toHaveCount(0);
  });
}

test('opens one FAQ answer at a time', async ({ page }) => {
  await page.goto('/#faq');
  await hydrated(page, '.faq-list');
  const directions = page.getByRole('button', {
    name: 'Does it give directions?',
  });
  const where = page.getByRole('button', { name: 'Where does it work?' });

  await directions.click();
  await expect(directions).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('No. It recommends')).toBeVisible();

  await where.click();
  await expect(where).toHaveAttribute('aria-expanded', 'true');
  await expect(directions).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Great Britain for now.')).toBeVisible();
});

test('moves the temperature range by keyboard and pointer', async ({
  page,
}) => {
  await page.goto('/');
  const coolest = page.getByRole('slider', {
    name: 'Coolest ideal temperature',
  });
  const warmest = page.getByRole('slider', {
    name: 'Warmest ideal temperature',
  });
  await coolest.scrollIntoViewIfNeeded();
  await hydrated(page, '.temp-card');

  await coolest.focus();
  await page.keyboard.press('ArrowRight');
  await expect(coolest).toHaveAttribute('aria-valuenow', '10');
  // The coolest handle stops a degree below the warmest.
  await page.keyboard.press('End');
  await expect(coolest).toHaveAttribute('aria-valuenow', '13');

  const ramp = page.locator('.ramp');
  const box = await ramp.boundingBox();
  if (!box) throw new Error('ramp has no box');
  await page.mouse.click(box.x + box.width - 1, box.y + box.height / 2);
  await expect(warmest).toHaveAttribute('aria-valuenow', '35');
});

test('thanks you for joining the beta', async ({ page }) => {
  await page.goto('/#beta');
  await hydrated(page, '.beta-form');
  await page
    .getByRole('textbox', { name: 'Email address' })
    .fill('rider@example.com');
  await page.getByRole('button', { name: 'Join the beta' }).click();
  await expect(page.getByText("✓ You're on the list.")).toBeFocused();
});

test('shows everything at once with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const unseen = await page.locator('[data-rv]:not([data-seen])').count();
  expect(unseen).toBe(0);
});

for (const width of [375, 430]) {
  test(`fits a ${width}px phone without sideways scrolling`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await scrollThrough(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('serves the 404 page', async ({ page }) => {
  const response = await page.goto('/nowhere');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Off route.' })).toBeVisible();
});
