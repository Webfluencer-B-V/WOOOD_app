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

test.skip("fetch", async () => {
	const response = await SELF.fetch("http://example.com/health");
	expect(response.status).toBe(200);
	const body = await response.json();
	expect(body.status).toBe("healthy");
});

// FIXME: upstream bundler issue
test.skip("worker", async () => {
	const request = new Request("http://example.com");
	const ctx = createExecutionContext();
	// biome-ignore lint/suspicious/noExplicitAny: upstream
	const response = await worker.fetch(request as any, env as Env, ctx);
	await waitOnExecutionContext(ctx);
	expect(await response.text()).toContain("<title>WOOOD</title>");
	expect(response.status).toBe(200);
});
