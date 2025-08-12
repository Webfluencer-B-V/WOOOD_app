import {
	createExecutionContext,
	env,
	SELF,
	waitOnExecutionContext,
} from "cloudflare:test";
import { afterEach, expect, test, vi } from "vitest";
import type { Env } from "./src/utils/consolidation";
import worker from "./worker";

afterEach(() => {
	vi.restoreAllMocks();
});

test("fetch", async () => {
	const response = await SELF.fetch("http://example.com");
	expect(await response.text()).toContain("<title>WOOOD</title>");
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
		return {
			keys: [] as Array<{ name: string }>,
			list_complete: true,
			cursor: undefined,
		};
	},
} satisfies KVNamespace;

test.skip("worker", async () => {
	const request = new Request("http://example.com");
	const ctx = createExecutionContext();
	const enrichedEnv = { ...env, SESSION_STORAGE: kvStub } as unknown as Env;
	const response = await worker.fetch(request, enrichedEnv, ctx);
	await waitOnExecutionContext(ctx);
	expect(await response.text()).toContain("<title>WOOOD</title>");
	expect(response.status).toBe(200);
});
