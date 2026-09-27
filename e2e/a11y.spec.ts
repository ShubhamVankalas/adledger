import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";

// Accessibility + responsive guard: every main page has no serious/critical axe violations
// (WCAG 2.1 A/AA + best practices) in light and dark mode, on a phone and on a desktop,
// and never scrolls sideways on a phone. Runs after smoke.spec.ts (see playwright.config.ts).
const EMAIL = "admin@example.com";
const PASSWORD = "adledger-demo-123";
const VIEWPORTS = [
  { name: "phone", width: 375, height: 812 },
  { name: "desktop", width: 1440, height: 900 },
] as const;
const THEMES = ["light", "dark"] as const;

test.describe.configure({ mode: "serial" });

let storage: Awaited<ReturnType<Awaited<ReturnType<Browser["newContext"]>>["storageState"]>>;
let contactPath = "";
let invitePath = "";

async function signIn(page: Page) {
  await page.goto("/");
  if (page.url().includes("/setup")) {
    await page.getByPlaceholder("Acme Inc").fill("Acme Analytics");
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

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signIn(page);
  await page.goto("/contacts?lifecycle=customer");
  contactPath = (await page.locator("tbody tr a").first().getAttribute("href")) ?? "";
  await page.goto("/settings/organization/members");
  await page.getByLabel("Email").fill("a11y-check@example.com");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invitation link")).toBeVisible();
  const link = await page.locator("code", { hasText: "/invite/" }).first().innerText();
  invitePath = new URL(link.trim()).pathname;
  storage = await ctx.storageState();
  await ctx.close();
});

async function audit(page: Page, label: string, width: number) {
  await page.waitForLoadState("networkidle");
  // Let charts and fonts settle so contrast is measured on the final render.
  await page.waitForTimeout(400);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"]).analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).slice(0, 5).join(" | ")}`);
  expect(blocking, `${label}: serious/critical axe violations`).toEqual([]);
  if (width < 768) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${label}: page scrolls horizontally on a phone`).toBeLessThanOrEqual(0);
  }
}

const APP_PAGES: [string, () => string][] = [
  ["overview", () => "/"],
  ["performance", () => "/performance?range=90d"],
  ["attribution", () => "/attribution?range=90d"],
  ["customers", () => "/customers"],
  ["live (placeholder)", () => "/live"],
  ["contacts", () => "/contacts?lifecycle=customer"],
  ["contact journey", () => contactPath],
  ["insights", () => "/insights"],
  ["setup checklist", () => "/onboarding"],
  ["account settings", () => "/settings/account"],
  ["workspace settings", () => "/settings/workspace"],
  ["tracking settings", () => "/settings/workspace/tracking"],
  ["integrations", () => "/settings/workspace/integrations"],
  ["notifications", () => "/settings/workspace/notifications"],
  ["import", () => "/settings/workspace/import"],
  ["AI settings", () => "/settings/workspace/ai"],
  ["API settings", () => "/settings/workspace/api"],
  ["organization", () => "/settings/organization"],
  ["members", () => "/settings/organization/members"],
  ["audit log", () => "/settings/organization/audit"],
];

for (const [name, path] of APP_PAGES) {
  test(`a11y: ${name}`, async ({ browser }) => {
    expect(path(), `${name}: path resolved in beforeAll`).toMatch(/^\//);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({ storageState: storage, viewport: { width: vp.width, height: vp.height }, colorScheme: theme });
        const page = await ctx.newPage();
        await page.goto(path());
        await expect(page.locator("h1").first()).toBeVisible();
        await audit(page, `${name} · ${vp.name} · ${theme}`, vp.width);
        await ctx.close();
      }
    }
  });
}

const PUBLIC_PAGES: [string, () => string][] = [
  ["sign in", () => "/login"],
  ["invitation", () => invitePath],
  ["not found", () => "/this-page-does-not-exist"],
];

for (const [name, path] of PUBLIC_PAGES) {
  test(`a11y: ${name}`, async ({ browser }) => {
    expect(path(), `${name}: path resolved in beforeAll`).toMatch(/^\//);
    for (const vp of VIEWPORTS) {
      for (const theme of THEMES) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, colorScheme: theme });
        const page = await ctx.newPage();
        await page.goto(path());
        await expect(page.locator("h1").first()).toBeVisible();
        await audit(page, `${name} · ${vp.name} · ${theme}`, vp.width);
        await ctx.close();
      }
    }
  });
}

test("responsive: performance shows sortable cards on a phone and the table on a desktop", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: storage, viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto("/performance?range=90d");
  await expect(page.locator("table")).toBeHidden();
  const cards = page.getByRole("list", { name: "Campaigns" }).getByRole("listitem");
  await expect(cards.first()).toBeVisible();
  const sortBy = page.getByRole("combobox", { name: "Sort by" });
  await expect(sortBy).toHaveValue("spendMinor:-1");

  const names = () => cards.locator("[data-slot=row-name]").allInnerTexts();
  await sortBy.selectOption({ label: "Name (A–Z)" });
  const byName = await names();
  expect(byName.length).toBeGreaterThan(1);
  expect(byName).toEqual([...byName].sort((a, b) => a.localeCompare(b)));

  // A sort chosen in the desktop table that the phone picker doesn't offer must not
  // be shown as one of the picker's options.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator("table")).toBeVisible();
  await page.locator("thead").getByRole("button", { name: "Clicks" }).click();
  await expect(page.locator("thead th[aria-sort]")).toHaveAttribute("aria-sort", "descending");
  await page.setViewportSize({ width: 375, height: 812 });
  await expect(sortBy).toHaveValue("clicks:-1");
  await ctx.close();
});

test("a11y: mobile navigation opens as a labelled dialog", async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: storage, viewport: { width: 375, height: 812 } });
  const page = await ctx.newPage();
  await page.goto("/");
  // Phones drop the header's sidebar toggle; the tab bar's "More" opens navigation.
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "More" }).click();
  const dialog = page.getByRole("dialog", { name: "Navigation" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Performance" })).toBeVisible();
  await audit(page, "mobile navigation", 375);
  await ctx.close();
});
