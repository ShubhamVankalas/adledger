import { expect, test, type Page } from "@playwright/test";

// Phone-sized journey: the bottom tab bar navigates between the main pages, "More" opens the sidebar
// sheet, and the app is installable (manifest + icons). Runs after smoke.spec.ts (see playwright.config.ts).
const EMAIL = "admin@example.com";
const PASSWORD = "adledger-demo-123";

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

async function signIn(page: Page) {
  await page.goto("/");
  if (page.url().includes("/setup")) {
    // Running on its own against a fresh database: create the demo workspace first.
    await page.getByPlaceholder("Acme Inc.").fill("Acme Analytics");
    await page.getByPlaceholder("Alex").fill("Demo Admin");
    await page.getByPlaceholder("you@company.com").fill(EMAIL);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.locator('select[name="timezone"]').selectOption("UTC");
    await page.getByRole("button", { name: "Create account & explore" }).click();
    await page.waitForURL((u) => u.pathname === "/", { timeout: 150_000 });
  } else if (page.url().includes("/login")) {
    await page.locator("#email").fill(EMAIL);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/");
  }
}

test("bottom tab bar navigates between pages", async ({ page }) => {
  await signIn(page);
  const nav = page.getByRole("navigation", { name: "Primary" });
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  if (process.env.SCREENSHOTS) {
    await page.waitForTimeout(900);
    await page.screenshot({ path: "docs/screenshots/mobile-overview.png" });
  }

  const pages = [
    { tab: "Performance", path: "/performance" },
    { tab: "Contacts", path: "/contacts" },
    { tab: "Insights", path: "/insights" },
    { tab: "Overview", path: "/" },
  ];
  for (const { tab, path } of pages) {
    await nav.getByRole("link", { name: tab }).click();
    await page.waitForURL((u) => u.pathname === path);
    await expect(nav.getByRole("link", { name: tab })).toHaveAttribute("aria-current", "page");
  }

  // "More" opens the sidebar sheet; following a link there closes it.
  await nav.getByRole("button", { name: "More" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet).toBeVisible();
  await sheet.getByRole("link", { name: "Integrations" }).click();
  await page.waitForURL(/\/settings\/workspace\/integrations/);
  await expect(sheet).toBeHidden();
  await expect(nav.getByRole("button", { name: "More" })).toBeVisible();
});

// The app shell clips horizontal overflow (so fixed elements stay on screen), which means anything wider
// than the phone would be cut off and unreachable. Wide tables must scroll inside their own container.
test("pages fit a phone-width screen without clipped content", async ({ page }) => {
  await signIn(page);
  await page.goto("/contacts");
  const contact = await page.locator('a[href^="/contacts/"]').first().getAttribute("href");
  const settings = ["", "/account", "/organization", "/organization/members", "/organization/audit", "/workspace", "/workspace/integrations", "/workspace/tracking", "/workspace/import", "/workspace/ai", "/workspace/api", "/workspace/notifications"];
  for (const path of ["/", "/performance", "/contacts", contact!, "/insights", "/onboarding", ...settings.map((s) => `/settings${s}`)]) {
    await page.goto(path);
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    // Elements poking past the right edge that are not inside their own horizontal scroller are cut off.
    const clipped = await page.locator('[data-slot="sidebar-inset"]').evaluate((main) => {
      const vw = document.documentElement.clientWidth;
      const scrolls = (el: Element) => {
        for (let a = el.parentElement; a && a !== main; a = a.parentElement) {
          if (["auto", "scroll"].includes(getComputedStyle(a).overflowX)) return true;
        }
        return false;
      };
      return [...main.querySelectorAll("*")]
        .filter((el) => el.getBoundingClientRect().right > vw + 1 && !el.closest('[data-slot="mobile-nav"]') && !scrolls(el))
        .slice(0, 3)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    });
    expect(clipped, `${path} has content wider than the screen`).toEqual([]);
    const shot = { "/performance": "mobile-performance", "/settings/workspace/integrations": "mobile-settings" }[path];
    if (process.env.SCREENSHOTS && shot) {
      await page.waitForTimeout(900);
      await page.screenshot({ path: `docs/screenshots/${shot}.png` });
    }
  }
});

test("report filters collapse into one button that opens a bottom sheet", async ({ page }) => {
  await signIn(page);
  await page.goto("/performance");
  // The inline desktop pickers are hidden; one summary button replaces them.
  await expect(page.getByRole("combobox", { name: "Date range" })).toBeHidden();
  const filters = page.getByRole("button", { name: /^Filters:/ });
  await expect(filters).toHaveAccessibleName(/30 days · Linear/);
  await filters.click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("radio", { name: "90 days" }).click();
  await sheet.getByRole("radio", { name: /First touch/ }).click();
  await sheet.getByLabel("Ad platform").selectOption("meta");
  await sheet.getByRole("button", { name: "Show results" }).click();
  await expect(sheet).toBeHidden();
  await expect(page).toHaveURL(/range=90d/);
  await expect(page).toHaveURL(/model=first_touch/);
  await expect(page).toHaveURL(/platform=meta/);
  await expect(filters).toHaveAccessibleName(/90 days · Meta · First touch/);
});

test("tab bar is hidden on desktop widths", async ({ page }) => {
  await signIn(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeHidden();
});

test("web app manifest and icons are served", async ({ page, request }) => {
  await page.goto("/login");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  expect(href).toBeTruthy();
  const res = await request.get(href!);
  expect(res.ok()).toBeTruthy();
  const manifest = await res.json();
  expect(manifest).toMatchObject({ name: "AdLedger", display: "standalone", start_url: "/" });
  const maskable = manifest.icons.find((i: { purpose?: string }) => i.purpose === "maskable");
  expect(maskable).toBeTruthy();
  for (const icon of [...manifest.icons, { src: "/icons/apple-touch-icon.png" }]) {
    expect((await request.get(icon.src)).ok()).toBeTruthy();
  }
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", "/icons/apple-touch-icon.png");
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", /^#/);
});
