import { expect, test } from "@playwright/test";

test("loads", async ({ page, baseURL }) => {
	// navigate with absolute URL to avoid baseURL race
	await page.goto(new URL("/apps/shopflare", baseURL).toString(), {
		waitUntil: "domcontentloaded",
	});
	await expect(page).toHaveTitle(/ShopFlare/);
	await expect(page.getByRole("heading", { name: "Ops!" })).toBeVisible();
});
