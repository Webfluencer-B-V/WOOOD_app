import { expect, test } from "@playwright/test";

const appUrl =
	process.env.SHOPIFY_APP_URL ||
	"https://woood-staging.leander-4e0.workers.dev";

test("direct app UI loads ShopFlare", async ({ page }) => {
	await page.goto(appUrl, { timeout: 30_000 });
	const title = await page.title();
	expect(title).toContain("ShopFlare");
	await expect(page.locator("body")).toContainText("ShopFlare");
});
