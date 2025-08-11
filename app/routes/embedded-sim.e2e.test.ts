import { expect, test } from "@playwright/test";

const shop = process.env.SHOP || "webfluencer-panda.myshopify.com";
const appUrl =
	process.env.SHOPIFY_APP_URL ||
	"https://woood-staging.leander-4e0.workers.dev";

test.skip("embedded simulation renders app", async ({ page }) => {
	const host = Buffer.from(`${shop}/admin`).toString("base64");
	await page.goto(`${appUrl}?embedded=1&shop=${shop}&host=${host}`, {
		timeout: 30_000,
	});

	await page.addInitScript(() => {
		// Minimal App Bridge environment simulation
		// @ts-ignore
		window.shopify = { environment: { embedded: true, development: true } };
	});

	await expect(page.locator("body")).toContainText("ShopFlare");
});
