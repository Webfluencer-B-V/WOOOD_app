import {
	createExecutionContext,
	env,
	SELF,
	waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";

import worker from "./worker";

afterEach(() => {
	vi.restoreAllMocks();
});

test("fetch", async () => {
	const response = await SELF.fetch("http://example.com");
	expect(await response.text()).toContain("<title>ShopFlare</title>");
	expect(response.status).toBe(200);
});

// FIXME: upstream bundler issue
// Provide minimal KV stub to satisfy Env typing
const kvStub = {
	async get() {
		return null;
	},
	async put() {},
	async delete() {},
	async list() {
		return { keys: [], list_complete: true } as any;
	},
} as any;

test.skip("worker", async () => {
	const request = new Request("http://example.com");
	const ctx = createExecutionContext();
	const enrichedEnv = { ...(env as any), SESSION_STORAGE: kvStub } as any;
	// biome-ignore lint/suspicious/noExplicitAny: upstream
	const response = await worker.fetch(request as any, enrichedEnv, ctx);
	await waitOnExecutionContext(ctx);
	expect(await response.text()).toContain("<title>ShopFlare</title>");
	expect(response.status).toBe(200);
});
