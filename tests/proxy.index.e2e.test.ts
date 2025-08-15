import { expect, test } from "@playwright/test";

test("loads", async ({ page, baseURL }) => {
	// navigate with absolute URL to avoid baseURL race
	await page.goto(new URL("/apps/WOOOD", baseURL).toString(), {
		waitUntil: "domcontentloaded",
	});
	await expect(page).toHaveTitle(/WOOOD/);
	await expect(page.getByRole("heading", { name: "Ops!" })).toBeVisible();
});
