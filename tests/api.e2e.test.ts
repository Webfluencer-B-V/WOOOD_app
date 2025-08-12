import { expect, test } from "@playwright/test";

const shop = process.env.SHOP || "webfluencer-panda.myshopify.com";
const appUrl =
	process.env.SHOPIFY_APP_URL ||
	"https://woood-staging.leander-4e0.workers.dev";

test.describe("API endpoints", () => {
	test("/health responds with healthy", async ({ request }) => {
		const response = await request.get(`${appUrl}/health`);
		expect(response.ok()).toBeTruthy();
		const body = await response.json();
		expect(body.status).toBe("healthy");
	});

	test("/api/delivery-dates returns dates or mock", async ({ request }) => {
		const response = await request.get(
			`${appUrl}/api/delivery-dates?shop=${encodeURIComponent(shop)}`,
		);
		expect(response.status()).toBeLessThan(500);
		const json = await response.json();
		expect(json).toBeTruthy();
	});

	test("store locator and experience center are now managed via app actions", async ({
		request,
	}) => {
		// Note: Store locator and experience center functionality has been moved to app actions
		// These endpoints should no longer exist at the Worker level
		const storeLocatorResponse = await request.get(
			`${appUrl}/api/store-locator?action=status`,
		);
		const experienceCenterResponse = await request.get(
			`${appUrl}/api/experience-center?action=status`,
		);

		// These endpoints must be removed or deprecated (no 5xx fallback)
		expect([404, 410].includes(storeLocatorResponse.status())).toBeTruthy();
		expect([404, 410].includes(experienceCenterResponse.status())).toBeTruthy();
	});
});
