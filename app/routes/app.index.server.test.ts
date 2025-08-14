import { env } from "node:process";
import type { AppLoadContext } from "react-router";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Route } from "./+types/app.index";
import { action, loader } from "./app.index";

// Mock the utility functions
vi.mock("../../src/utils/experienceCenter", () => ({
	fetchExperienceCenterData: vi.fn().mockResolvedValue({
		data: [{ ean: "123456789", channel: "EC" }],
		total: 1,
	}),
	processExperienceCenterWithBulkOperations: vi.fn().mockResolvedValue({
		successful: 10,
		failed: 0,
		errors: [],
		eanMatches: 5,
		totalProducts: 10,
	}),
}));

vi.mock("../../src/utils/storeLocator", () => ({
	fetchAndTransformDealers: vi
		.fn()
		.mockResolvedValue([
			{ name: "Test Dealer", code: "123", city: "Amsterdam" },
		]),
	upsertShopMetafield: vi.fn().mockResolvedValue({
		success: true,
		timestamp: new Date().toISOString(),
		count: 1,
	}),
}));

vi.mock("../../src/utils/webhooks", () => ({
	registerWebhooks: vi.fn().mockResolvedValue(undefined),
}));

// Mock the shopify server
vi.mock("~/shopify.server", () => ({
	createShopify: vi.fn(() => ({
		utils: {
			log: {
				debug: vi.fn(),
				error: vi.fn(),
			},
		},
		admin: vi.fn(() => ({
			request: vi.fn().mockResolvedValue({
				data: {
					shop: {
						name: "Test Shop",
						myshopifyDomain: "test.myshopify.com",
					},
				},
			}),
		})),
	})),
	ShopifyException: class ShopifyException extends Error {
		type = "GRAPHQL";
		errors = [];
	},
}));

const createMockContext = (
	overrides: Partial<AppLoadContext> = {},
): AppLoadContext =>
	({
		cloudflare: {
			env: {
				DUTCH_FURNITURE_BASE_URL: "https://api.example.com",
				DUTCH_FURNITURE_API_KEY: "test-key",
				CLOUDFLARE_URL: "https://test-worker.dev",
				EXPERIENCE_CENTER_STATUS: {
					get: vi.fn().mockResolvedValue(null),
					put: vi.fn().mockResolvedValue(undefined),
				},
				STORE_LOCATOR_STATUS: {
					get: vi.fn().mockResolvedValue(null),
					put: vi.fn().mockResolvedValue(undefined),
				},
				...env,
			},
		},
		...overrides,
	}) as AppLoadContext;

describe("app.index loader", () => {
	test("successfully loads shop data and status", async () => {
		const context = createMockContext();
		const request = new Request("http://localhost");

		const result = await loader({ context, request } as Route.LoaderArgs);

		expect(result).toMatchObject({
			data: {
				shop: {
					name: "Test Shop",
					myshopifyDomain: "test.myshopify.com",
				},
			},
			errors: undefined,
			experienceCenterStatus: null,
			storeLocatorStatus: null,
		});
	});
});

describe("app.index action", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	test("sync-experience-center action succeeds", async () => {
		const context = createMockContext();
		const formData = new FormData();
		formData.append("action", "sync-experience-center");

		const request = new Request("http://localhost", {
			method: "POST",
			body: formData,
		});

		const result = await action({ context, request } as Route.ActionArgs);

		expect(result).toMatchObject({
			success: true,
			message: expect.stringContaining("Experience Center sync completed"),
			result: {
				successful: 10,
				failed: 0,
				eanMatches: 5,
				totalProducts: 10,
			},
		});

		// Verify status was stored in KV
		expect(
			context.cloudflare.env.EXPERIENCE_CENTER_STATUS!.put,
		).toHaveBeenCalled();
	});

	test("sync-store-locator action succeeds", async () => {
		const context = createMockContext();
		const formData = new FormData();
		formData.append("action", "sync-store-locator");

		const request = new Request("http://localhost", {
			method: "POST",
			body: formData,
		});

		const result = await action({ context, request } as Route.ActionArgs);

		expect(result).toMatchObject({
			success: true,
			message: expect.stringContaining(
				"Store Locator sync completed. 1 dealers updated",
			),
			result: {
				success: true,
				count: 1,
			},
		});

		// Verify status was stored in KV
		expect(context.cloudflare.env.STORE_LOCATOR_STATUS!.put).toHaveBeenCalled();
	});

	test("register-webhooks action succeeds", async () => {
		const context = createMockContext();
		const formData = new FormData();
		formData.append("action", "register-webhooks");

		const request = new Request("http://localhost", {
			method: "POST",
			body: formData,
		});

		const result = await action({ context, request } as Route.ActionArgs);

		expect(result).toMatchObject({
			success: true,
			message: "Webhooks registered successfully.",
		});
	});

	test("unknown action returns error", async () => {
		const context = createMockContext();
		const formData = new FormData();
		formData.append("action", "unknown-action");

		const request = new Request("http://localhost", {
			method: "POST",
			body: formData,
		});

		const result = await action({ context, request } as Route.ActionArgs);

		expect(result).toMatchObject({
			success: false,
			message: "Unknown action",
		});
	});

	test("action handles errors gracefully", async () => {
		const context = createMockContext();
		const formData = new FormData();
		formData.append("action", "sync-experience-center");

		const request = new Request("http://localhost", {
			method: "POST",
			body: formData,
		});

		// Mock an error in the utility function
		const mockFetchExperienceCenterData = await import(
			"../../src/utils/experienceCenter"
		);
		vi.mocked(
			mockFetchExperienceCenterData.fetchExperienceCenterData,
		).mockRejectedValueOnce(new Error("API Error"));

		const result = await action({ context, request } as Route.ActionArgs);

		expect(result).toMatchObject({
			success: false,
			message: expect.stringContaining("Action failed: API Error"),
		});

		// Verify error status was stored in KV
		expect(
			context.cloudflare.env.EXPERIENCE_CENTER_STATUS!.put,
		).toHaveBeenCalledWith(
			expect.stringContaining("ec_last_sync:test.myshopify.com"),
			expect.stringContaining('"success":false'),
		);
	});
});
