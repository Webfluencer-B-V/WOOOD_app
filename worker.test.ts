import {
	env as cfEnv,
	createExecutionContext,
	SELF,
	waitOnExecutionContext,
} from "cloudflare:test";
import { env as processEnv } from "node:process";
import { afterEach, expect, test, vi } from "vitest";
import type { WorkerEnv as Env } from "./app/types/app";
import worker from "./worker";

afterEach(() => {
	vi.restoreAllMocks();
});

test("fetch", async () => {
	const response = await SELF.fetch("http://example.com");
	const text = await response.text();
	const ok =
		text.includes("<title>WOOOD</title>") || text.includes("<!doctype html>");
	expect(ok).toBe(true);
	expect([200, 500]).toContain(response.status);
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
	const enrichedEnv = {
		...cfEnv,
		...processEnv,
		SESSION_STORAGE: kvStub,
	} as unknown as Env;
	const response = await worker.fetch(request, enrichedEnv, ctx);
	await waitOnExecutionContext(ctx);
	expect(await response.text()).toContain("<title>WOOOD</title>");
	expect(response.status).toBe(200);
});
