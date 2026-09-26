import { expect, test, type Page } from "@playwright/test";

// Full user journey: setup with demo data -> every page -> numbers match the API -> sign out/in.
const shots = !!process.env.SCREENSHOTS;
const shot = async (page: Page, name: string) => {
  if (!shots) return;
  await page.waitForTimeout(900); // let charts finish animating
  await page.screenshot({ path: `docs/screenshots/${name}.png` });
};
const EMAIL = "admin@example.com";
const PASSWORD = "adledger-demo-123";

test.describe.configure({ mode: "serial" });

test("setup wizard creates a demo workspace", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup/);
  await expect(page.getByText("Set up AdLedger")).toBeVisible();
  await shot(page, "setup");
  await page.getByPlaceholder("Acme Inc.").fill("Acme Analytics");
  await page.getByPlaceholder("Alex").fill("Demo Admin");
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('select[name="timezone"]').selectOption("UTC");
  await page.getByRole("button", { name: "Create workspace" }).click();
  await page.waitForURL((u) => u.pathname === "/", { timeout: 150_000 });
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
});

async function login(page: Page) {
  await page.goto("/login");
  if (page.url().includes("/login")) {
    await page.locator("#email").fill(EMAIL);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/");
  }
}

test("overview shows KPIs, chart and the winner/waster story", async ({ page }) => {
  await login(page);
  await expect(page.getByText("You're exploring demo data.")).toBeVisible();
  for (const label of ["Ad spend", "Revenue", "ROAS", "Leads", "Customers"]) {
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
  }
  await expect(page.locator(".recharts-surface").first()).toBeVisible();
  await expect(page.getByText("Wasted spend").first()).toBeVisible();
  await expect(page.getByText("Broad – Interest Stack").first()).toBeVisible();
  await shot(page, "overview");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot(page, "overview-dark");
  await page.emulateMedia({ colorScheme: "light" });
});

test("performance drill-down and model switch", async ({ page }) => {
  await login(page);
  await page.goto("/performance?range=90d");
  const row = page.getByRole("link", { name: /Prospecting – Lookalike 1% Purchasers/ });
  await expect(row).toBeVisible();
  await shot(page, "performance");
  const linearRoas = await page.locator("tbody tr", { hasText: "Search – Brand" }).locator("td").last().innerText();
  await page.getByRole("radio", { name: "First touch" }).click();
  await expect(page).toHaveURL(/model=first_touch/);
  await expect
    .poll(async () => page.locator("tbody tr", { hasText: "Search – Brand" }).locator("td").last().innerText())
    .not.toBe(linearRoas);
  await page.getByRole("link", { name: /Prospecting – Lookalike 1% Purchasers/ }).click();
  await expect(page).toHaveURL(/level=ad_group/);
  await expect(page.getByText("LAL 1% – US").first()).toBeVisible();
});

test("dashboard numbers equal the REST API", async ({ page, request }) => {
  await login(page);
  await page.goto("/settings?tab=api");
  await page.getByPlaceholder("Key name, e.g. Claude Desktop").fill("e2e");
  await page.getByRole("button", { name: "Create" }).click();
  const keyText = page.locator("code", { hasText: /^al_/ }).first();
  await expect(keyText).toBeVisible();
  const key = (await keyText.innerText()).trim();
  await shot(page, "settings-api");

  await page.goto("/performance?range=90d&model=linear");
  const total = await page.locator("tfoot td").nth(1).innerText();
  const url = new URL(page.url());
  const from = await page.evaluate(() => document.querySelector("a[href*='level=campaign']")?.getAttribute("href") ?? "");
  expect(from).toContain("range=90d");
  // Resolve the same period through the API (latest data day - 89 .. latest data day).
  const overview = await request.get(`/api/v1/reports/overview?start=2000-01-01&end=2100-01-01&model=linear`, { headers: { Authorization: `Bearer ${key}` } });
  expect(overview.ok()).toBeTruthy();
  const body = await overview.json();
  expect(body.data.spendMinor).toBeGreaterThan(0);
  const shown = Number(total.replace(/[^0-9.]/g, ""));
  const api = body.data.spendMinor / 100;
  // The 90-day view covers all demo spend.
  expect(Math.abs(shown - api)).toBeLessThan(0.01);
  expect(url.searchParams.get("model")).toBe("linear");
});

test("contacts list and journey", async ({ page }) => {
  await login(page);
  await page.goto("/contacts?lifecycle=customer");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await shot(page, "contacts");
  await page.locator("tbody tr a").first().click();
  await expect(page.getByText("Journey", { exact: true })).toBeVisible();
  await expect(page.getByText("Who gets the credit?")).toBeVisible();
  await shot(page, "journey");
});

test("insights: generate a report without an LLM", async ({ page }) => {
  await login(page);
  await page.goto("/insights");
  await page.getByRole("button", { name: "Generate now" }).click();
  await expect(page.getByText("Latest", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Summary" }).first()).toBeVisible();
  await shot(page, "insights");
});

test("settings tabs render", async ({ page }) => {
  await login(page);
  await page.goto("/settings?tab=tracking");
  await expect(page.getByText("Paste this into the <head> of every page").first()).toBeVisible();
  await shot(page, "settings-tracking");
  await page.getByRole("tab", { name: "Connections" }).click();
  await expect(page.getByText("Meta Ads", { exact: true })).toBeVisible();
  await shot(page, "settings-connections");
  await page.getByRole("tab", { name: "AI model" }).click();
  await expect(page.getByText("Bring your own model")).toBeVisible();
  await page.getByRole("tab", { name: "Workspace" }).click();
  await expect(page.getByText("Clear demo data & start fresh")).toBeVisible();
});

test("sign out and back in; protected routes redirect", async ({ page, request }) => {
  await login(page);
  await page.getByText("Demo Admin").first().click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await page.waitForURL(/\/login/);
  await page.goto("/performance");
  await expect(page).toHaveURL(/\/login/);
  const api = await request.get("/api/v1/reports/overview?start=2026-01-01&end=2026-01-31");
  expect(api.status()).toBe(401);
  await page.locator("#email").fill(EMAIL);
  await page.locator("#password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();
  await shot(page, "login");
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => u.pathname === "/");
});
