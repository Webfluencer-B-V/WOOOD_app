import { env } from "node:process";
import type { AppLoadContext } from "react-router";
import { describe, expect, test } from "vitest";

import { API_VERSION } from "~/const";
import type { Route } from "./+types/shopify.webhooks";
import { action } from "./shopify.webhooks";

// Mock KVNamespace for SESSION_STORAGE
const mockKV = {
	get: () => Promise.resolve(null),
	put: () => Promise.resolve(),
	delete: () => Promise.resolve(),
	list: () => Promise.resolve({ keys: [], list_complete: true, cursor: "" }),
	getWithMetadata: () => Promise.resolve({ value: null, metadata: null }),
} as unknown as KVNamespace;

const context = {
	cloudflare: {
		env: {
			...env,
			SESSION_STORAGE: mockKV,
		},
	},
} as unknown as AppLoadContext;

describe("action", () => {
	test("error on body missing", async () => {
		const request = new Request("http://localhost");
		const response = await action({ context, request } as Route.ActionArgs);

		expect(response).toBeInstanceOf(Response);
		expect(response.ok).toBe(false);
		expect(response.status).toBe(400);
		expect(await response.text()).toBe("Webhook body is missing");
	});

	test("error on header missing", async () => {
		const request = new Request("http://localhost", {
			body: "123",
			method: "POST",
		});
		const response = await action({ context, request } as Route.ActionArgs);

		expect(response).toBeInstanceOf(Response);
		expect(response.ok).toBe(false);
		expect(response.status).toBe(400);
		expect(await response.text()).toBe("Webhook header is missing");
	});

	test("error on encoded byte length mismatch", async () => {
		const request = new Request("http://localhost", {
			body: "123",
			headers: { "X-Shopify-Hmac-Sha256": "123" },
			method: "POST",
		});
		const response = await action({ context, request } as Route.ActionArgs);

		expect(response).toBeInstanceOf(Response);
		expect(response.ok).toBe(false);
		expect(response.status).toBe(401);
		expect(await response.text()).toBe("Encoded byte length mismatch");
	});

	test("error on invalid hmac", async () => {
		const request = new Request("http://localhost", {
			body: "132", // NOTE: changed
			headers: {
				"X-Shopify-Hmac-Sha256": await getHmac("123"), // HMAC for different data
			},
			method: "POST",
		});
		const response = await action({ context, request } as Route.ActionArgs);

		expect(response).toBeInstanceOf(Response);
		expect(response.ok).toBe(false);
		expect(response.status).toBe(401);
		expect(await response.text()).toBe("Invalid hmac");
	});

	test("error on missing headers", async () => {
		const request = new Request("http://localhost", {
			body: "123",
			headers: {
				"X-Shopify-Hmac-Sha256": await getHmac("123"),
			},
			method: "POST",
		});
		const response = await action({ context, request } as Route.ActionArgs);

		expect(response).toBeInstanceOf(Response);
		expect(response.ok).toBe(false);
		expect(response.status).toBe(400);
		expect(await response.text()).toBe("Webhook headers are missing");
	});

	test("success", async () => {
		const body = JSON.stringify({ id: 123, domain: "test.myshopify.com" });
		const request = new Request("http://localhost", {
			body,
			headers: {
				"X-Shopify-API-Version": API_VERSION,
				"X-Shopify-Shop-Domain": "test.myshopify.com",
				"X-Shopify-Hmac-Sha256": await getHmac(body),
				"X-Shopify-Topic": "app/uninstalled",
				"X-Shopify-Webhook-Id": "test",
			},
			method: "POST",
		});
		const response = await action({ context, request } as Route.ActionArgs);

		expect(response).toBeInstanceOf(Response);
		expect(response.ok).toBe(true);
		expect(response.status).toBe(204);
		expect(response.body).toBe(null);
	});
});

async function getHmac(body: string) {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(context.cloudflare.env.SHOPIFY_API_SECRET_KEY),
		{
			name: "HMAC",
			hash: "SHA-256",
		},
		true,
		["sign"],
	);
	const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	const hmac = btoa(String.fromCharCode(...new Uint8Array(signature))); // base64
	return hmac;
}
