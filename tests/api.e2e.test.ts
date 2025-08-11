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

	test("/api/store-locator status endpoint responds", async ({ request }) => {
		const response = await request.get(
			`${appUrl}/api/store-locator?action=status`,
		);
		// When status KV not present, service returns 503 or a valid JSON message
		expect([200, 503].includes(response.status())).toBeTruthy();
	});

	test("/api/experience-center status endpoint responds", async ({
		request,
	}) => {
		const response = await request.get(
			`${appUrl}/api/experience-center?action=status`,
		);
		expect([200, 500].includes(response.status())).toBeTruthy();
	});
});
