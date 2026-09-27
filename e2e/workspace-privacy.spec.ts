import { expect, test, type Page } from "@playwright/test";

// Privacy tools in the real UI: contact CSV, subject-access export, erasure dialog,
// full workspace export and the retention setting. Runs after smoke.spec.ts (file order),
// but also works on its own: it creates the demo workspace if the install is fresh.
const EMAIL = "admin@example.com";
const PASSWORD = "adledger-demo-123";

test.describe.configure({ mode: "serial" });

const retentionForm = (page: Page) => page.locator("form", { has: page.locator("#retention-days") });

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
    return;
  }
  if (page.url().includes("/login")) {
    await page.locator("#email").fill(EMAIL);
    await page.locator("#password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL((u) => u.pathname === "/");
  }
}

test("contacts CSV follows the current filter", async ({ page }) => {
  await signIn(page);
  await page.goto("/contacts?lifecycle=customer");
  // Base UI renders these download links with role="button".
  const link = page.getByRole("button", { name: "Export CSV" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  expect(href).toBe("/api/v1/exports/contacts?lifecycle=customer");
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/^adledger-.+-contacts-\d{4}-\d{2}-\d{2}\.csv$/);
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/text\/csv/);
  expect(res.headers()["content-disposition"]).toMatch(/attachment; filename="adledger-.+-contacts-\d{4}-\d{2}-\d{2}\.csv"/);
  const lines = (await res.text()).trim().split("\r\n");
  expect(lines[0]).toBe("id,email,name,lifecycle,first_seen_at,first_lead_at,first_channel,first_campaign,touchpoints,revenue,revenue_minor,currency");
  expect(lines.length).toBeGreaterThan(1);
  for (const l of lines.slice(1)) expect(l).toContain(",customer,");
});

test("contact page: export data, then delete the contact", async ({ page }) => {
  await signIn(page);
  await page.goto("/contacts?lifecycle=customer");
  await page.locator("tbody tr a").first().click();
  await expect(page.getByText("Journey", { exact: true })).toBeVisible();
  const contactUrl = page.url();
  const id = new URL(contactUrl).pathname.split("/").pop()!;

  const exportHref = await page.getByRole("button", { name: "Export data" }).getAttribute("href");
  expect(exportHref).toBe(`/api/v1/contacts/${id}/export`);
  const sar = await page.request.get(exportHref!);
  expect(sar.status()).toBe(200);
  const data = await sar.json();
  expect(data.format).toBe("adledger-subject-access");
  expect(data.contact.id).toBe(id);
  expect(data.payments.length).toBeGreaterThan(0);

  // Cancel keeps the contact.
  await page.getByRole("button", { name: "Delete contact" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("This cannot be undone.");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toBeHidden();

  await page.getByRole("button", { name: "Delete contact" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete permanently" }).click();
  await expect(page.getByText("Contact deleted.")).toBeVisible();
  // The embedded database re-renders every revalidated page, which can be slow under load.
  await page.waitForURL((u) => u.pathname === "/contacts", { timeout: 120_000 });

  // Streamed page (loading.tsx), so the not-found UI arrives with a 200.
  await page.goto(contactUrl);
  await expect(page.getByText("This page doesn’t exist.")).toBeVisible();
  expect((await page.request.get(exportHref!)).status()).toBe(404);
});

test("settings: full workspace export and event retention", async ({ page }) => {
  await signIn(page);
  await page.goto("/settings/workspace");
  await expect(page.getByText("Privacy & data ownership")).toBeVisible();

  const exportButton = page.getByRole("button", { name: /Download export/ });
  const href = await exportButton.getAttribute("href");
  const [download] = await Promise.all([page.waitForEvent("download"), exportButton.click()]);
  expect(download.suggestedFilename()).toMatch(/^adledger-.+-export-\d{4}-\d{2}-\d{2}\.json$/);
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  const doc = JSON.parse(await res.text());
  expect(doc.format).toBe("adledger-workspace-export");
  expect(doc.tables.contacts.length).toBeGreaterThan(0);
  expect(JSON.stringify(doc.tables.connections)).not.toContain("secrets_enc");

  const input = page.locator("#retention-days");
  await input.fill("400");
  await retentionForm(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText(/Raw events older than 400 days are deleted daily/)).toBeVisible();
  await page.reload();
  await expect(page.locator("#retention-days")).toHaveValue("400");
  await expect(page.getByText(/Last run/)).toBeVisible();

  await page.locator("#retention-days").fill("");
  await retentionForm(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Data retention turned off.", { exact: false })).toBeVisible();
  await page.reload();
  await expect(page.locator("#retention-days")).toHaveValue("");
});
