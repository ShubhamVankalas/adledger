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
  await expect(page.getByText("Welcome to AdLedger")).toBeVisible();
  await shot(page, "setup");
  await page.getByPlaceholder("Acme Inc").fill("Acme Analytics");
  await page.getByPlaceholder("Alex").fill("Demo Admin");
  await page.getByPlaceholder("you@company.com").fill(EMAIL);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.locator('select[name="timezone"]').selectOption("UTC");
  await page.getByRole("button", { name: "Create account & explore" }).click();
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
  // The demo workspace shows a "Sample data" pill in the header and the E-commerce board.
  await expect(page.getByText("Sample data", { exact: true }).first()).toBeVisible();
  for (const label of ["Ad spend", "Revenue", "ROAS", "MER", "Customers"]) {
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
  await page.goto("/settings/workspace/api");
  await page.getByLabel("Key name").fill("e2e");
  await page.getByRole("button", { name: "Create" }).click();
  // The new key is shown once in a copy field (its full value is the title; the list only shows prefixes).
  const keyText = page.locator('code[title^="al_"]').first();
  await expect(keyText).toBeVisible();
  const key = ((await keyText.getAttribute("title")) ?? "").trim();
  await shot(page, "settings-api");

  await page.goto("/performance?range=90d&model=linear");
  // Level tabs keep the period (the Campaigns tab is the default level, so it has no level param).
  const from = (await page.getByRole("navigation", { name: "Report level" }).getByRole("link", { name: "Ad sets" }).getAttribute("href")) ?? "";
  expect(from).toContain("range=90d");

  // The same custom period in the table and through the API. The totals cell also shows the
  // change vs the previous period under the value, so read its first line only.
  await page.goto("/performance?from=2000-01-01&to=2100-01-01&model=linear");
  const total = (await page.locator("tfoot td").nth(1).innerText()).split("\n")[0];
  const url = new URL(page.url());
  const overview = await request.get(`/api/v1/reports/overview?start=2000-01-01&end=2100-01-01&model=linear`, { headers: { Authorization: `Bearer ${key}` } });
  expect(overview.ok()).toBeTruthy();
  const body = await overview.json();
  expect(body.data.spendMinor).toBeGreaterThan(0);
  const shown = Number(total.replace(/[^0-9.]/g, ""));
  const api = body.data.spendMinor / 100;
  // Tables show whole currency units.
  expect(shown).toBe(Math.round(api));
  expect(url.searchParams.get("model")).toBe("linear");
});

test("contacts list and journey", async ({ page }) => {
  await login(page);
  await page.goto("/contacts?lifecycle=customer");
  await expect(page.locator("tbody tr").first()).toBeVisible();
  await shot(page, "contacts");
  // A plain click opens the preview sheet; the record page is the link's target.
  await page.locator("tbody tr a").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.goto((await page.locator("tbody tr a").first().getAttribute("href"))!);
  await expect(page.getByRole("tab", { name: "Activity" })).toBeVisible();
  await page.getByRole("tab", { name: "Attribution" }).click();
  await expect(page.getByText(/splits this contact’s revenue|Every model agrees|No revenue to split yet/).first()).toBeVisible();
  await page.getByRole("tab", { name: "Receipt" }).click();
  await expect(page.getByText("Cost to acquire")).toBeVisible();
  await shot(page, "journey");
});

test("insights: generate a report without an LLM", async ({ page }) => {
  await login(page);
  await page.goto("/insights");
  await page.getByRole("button", { name: "Generate report", exact: true }).click();
  await expect(page.getByText("Latest", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("heading", { name: "Summary" }).first()).toBeVisible();
  await shot(page, "insights");
});

test("settings pages render", async ({ page }) => {
  await login(page);
  await page.goto("/settings/workspace/tracking");
  await expect(page.getByText("Paste this into the <head> of every page").first()).toBeVisible();
  await shot(page, "settings-tracking");
  await page.goto("/settings/workspace/integrations");
  await expect(page.getByText("TikTok Ads", { exact: true })).toBeVisible();
  await expect(page.getByText("Shopify", { exact: true })).toBeVisible();
  await shot(page, "settings-integrations");
  await page.getByRole("button", { name: /Stripe/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Secret or restricted key");
  await page.keyboard.press("Escape");
  await page.goto("/settings/workspace/notifications");
  await expect(page.getByText("Microsoft Teams", { exact: true })).toBeVisible();
  await shot(page, "settings-notifications");
  await page.goto("/settings/organization/members");
  await expect(page.getByText("Invite someone")).toBeVisible();
  await page.getByLabel("Email").fill("analyst@example.com");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invitation link")).toBeVisible();
  await shot(page, "settings-members");
  await page.goto("/settings/workspace/import");
  await expect(page.getByText("Ad spend CSV")).toBeVisible();
  await page.goto("/settings/organization/audit");
  await expect(page.getByText("invited").first()).toBeVisible();
  await page.goto("/onboarding");
  await expect(page.locator("#pixel").getByText("Install the tracking pixel")).toBeVisible();
  await shot(page, "onboarding");
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
