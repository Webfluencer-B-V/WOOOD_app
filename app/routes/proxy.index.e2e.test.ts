import { expect, test } from "@playwright/test";

test("loads", async ({ page }) => {
	await page.goto("/apps/WOOOD");
	await expect(page).toHaveTitle(/WOOOD/);
	await expect(page.getByRole("heading", { name: "Ops!" })).toBeVisible();
});
