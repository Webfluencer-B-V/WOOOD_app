import { env } from "node:process";
import type { AppLoadContext } from "react-router";
import { describe, expect, test } from "vitest";

import { createShopify } from "./shopify.server";

const context = { cloudflare: { env } } as unknown as AppLoadContext;

test("createShopify", () => {
	const shopify = createShopify(context);
	expect(shopify.admin).toBeDefined();
});

describe("utils", () => {
	const { utils } = createShopify(context);

	test("allowedDomains", () => {
		expect(utils.allowedDomains).toBe(
			"myshopify\\.com|myshopify\\.io|shop\\.dev|shopify\\.com",
		);
	});

	test("encode", async () => {
		const encoder = new TextEncoder();
		const data = encoder.encode("test");

		expect(utils.encode(data.buffer, "base64")).toBe("dGVzdA==");
		expect(utils.encode(data.buffer, "hex")).toBe("74657374");
	});

	test("legacyUrlToShopAdminUrl", () => {
		expect(utils.legacyUrlToShopAdminUrl("test.myshopify.com")).toBe(
			"admin.shopify.com/store/test",
		);
		expect(utils.legacyUrlToShopAdminUrl("test.example.com")).toBe(null);
	});

	test("sanitizeHost", () => {
		const host = btoa("test.myshopify.com");
		expect(utils.sanitizeHost(host)).toBe(host);
		expect(utils.sanitizeHost(btoa("test.example.com"))).toBe(null);
	});

	test("sanitizeShop", () => {
		const shop = "test.myshopify.com";
		expect(utils.sanitizeShop("admin.shopify.com/store/test")).toBe(shop);
		expect(utils.sanitizeShop(shop)).toBe(shop);
		expect(utils.sanitizeShop("test.example.com")).toBe(null);
	});

	test("validateHmac", async () => {
		const data = "123";
		const encoding = "base64" as const;

		// Compute HMAC using the same secret as the code under test
		const encoder = new TextEncoder();
		const key = await crypto.subtle.importKey(
			"raw",
			encoder.encode(env.SHOPIFY_API_SECRET_KEY),
			{ name: "HMAC", hash: "SHA-256" },
			true,
			["sign"],
		);
		const signature = await crypto.subtle.sign(
			"HMAC",
			key,
			encoder.encode(data),
		);
		const hmac = btoa(String.fromCharCode(...new Uint8Array(signature)));

		expect.assertions(2);
		expect(await utils.validateHmac(data, hmac, encoding)).toBeUndefined();
		await expect(utils.validateHmac("124", hmac, encoding)).rejects.toThrow(
			"Invalid hmac",
		);
	});
});
