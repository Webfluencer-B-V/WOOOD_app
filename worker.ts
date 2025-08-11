/// <reference types="vite/client" />

import { createRequestHandler } from "react-router";
import type { WebhookQueueMessage } from "./app/types/app";
import {
	DEFAULT_FEATURE_FLAGS,
	type Env,
	type FeatureFlags,
	isFeatureEnabled,
} from "./src/utils/consolidation";
import {
	fetchExperienceCenterData,
	getInstalledShops,
	processExperienceCenterUpdateAllShops,
} from "./src/utils/experienceCenter";
import {
	fetchAndTransformDealers,
	upsertShopMetafield,
} from "./src/utils/storeLocator";
import { handleOrderWebhook, registerWebhooks } from "./src/utils/webhooks";

const FEATURE_FLAGS: FeatureFlags = DEFAULT_FEATURE_FLAGS;

declare module "react-router" {
	export interface AppLoadContext {
		cloudflare: {
			ctx: ExecutionContext;
			env: Env;
		};
	}
}

const requestHandler = createRequestHandler(
	() => import("virtual:react-router/server-build"),
	import.meta.env.MODE,
);

async function cleanupOldTokens(env: Env): Promise<void> {
	if (!env.WOOOD_KV) return;
	const keys = await env.WOOOD_KV.list({ prefix: "shop_token:" });
	for (const key of keys.keys) {
		const shop = key.name.replace("shop_token:", "");
		try {
			const tokenRecord = (await env.WOOOD_KV.get(key.name, "json")) as any;
			if (tokenRecord?.accessToken) {
				const response = await fetch(
					`https://${shop}/admin/api/2023-10/shop.json`,
					{ headers: { "X-Shopify-Access-Token": tokenRecord.accessToken } },
				);
				if (!response.ok) await env.WOOOD_KV.delete(key.name);
			}
		} catch {
			await env.WOOOD_KV.delete(key.name);
		}
	}
}

function generateMockDates(): Array<{ date: string; displayName: string }> {
	const dates: Array<{ date: string; displayName: string }> = [];
	const today = new Date();
	for (let i = 1; i <= 14; i++) {
		const date = new Date(today);
		date.setDate(today.getDate() + i);
		if (date.getDay() === 0 || date.getDay() === 6) continue;
		const formattedDate = date.toISOString().split("T")[0];
		const displayName = date.toLocaleDateString("nl-NL", {
			weekday: "long",
			day: "numeric",
			month: "long",
		});
		dates.push({ date: formattedDate, displayName });
	}
	return dates;
}

async function handleDeliveryDates(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!isFeatureEnabled(FEATURE_FLAGS, "ENABLE_DELIVERY_DATES_API")) {
		return new Response("Delivery dates API disabled", { status: 503 });
	}
	try {
		const url = new URL(request.url);
		const shop = url.searchParams.get("shop");
		if (!shop) {
			return new Response(
				JSON.stringify({ error: "Shop parameter is required" }),
				{ status: 400, headers: { "Content-Type": "application/json" } },
			);
		}
		let accessToken: string | null = null;
		if (env.WOOOD_KV) {
			const tokenRecord = (await env.WOOOD_KV.get(`shop_token:${shop}`, {
				type: "json",
			} as any)) as any;
			accessToken = tokenRecord?.accessToken || null;
		}
		if (!accessToken) {
			const mockDates = generateMockDates();
			return new Response(JSON.stringify({ dates: mockDates }), {
				headers: { "Content-Type": "application/json" },
			});
		}
		if (env.DUTCHNED_API_URL && env.DUTCHNED_API_CREDENTIALS) {
			try {
				const response = await fetch(`${env.DUTCHNED_API_URL}/delivery-dates`, {
					headers: {
						Authorization: `Basic ${env.DUTCHNED_API_CREDENTIALS}`,
						"Content-Type": "application/json",
					},
				});
				if (response.ok) {
					const data = await response.json();
					return new Response(JSON.stringify(data), {
						headers: { "Content-Type": "application/json" },
					});
				}
			} catch (error) {
				console.error("DutchNed API error:", error);
			}
		}
		const mockDates = generateMockDates();
		return new Response(JSON.stringify({ dates: mockDates }), {
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error("Delivery dates API error:", error);
		return new Response(JSON.stringify({ error: "Internal server error" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
}

async function handleStoreLocator(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!isFeatureEnabled(FEATURE_FLAGS, "ENABLE_STORE_LOCATOR")) {
		return new Response("Store locator API disabled", { status: 503 });
	}
	try {
		const url = new URL(request.url);
		const action = url.searchParams.get("action");
		if (action === "upsert") {
			try {
				const dealers = await fetchAndTransformDealers(env);
				const shops = await getInstalledShops(env);
				const results: any[] = [];
				for (const shop of shops) {
					try {
						const result = await upsertShopMetafield(env, dealers, shop);
						results.push({ shop, ...result });
					} catch (error) {
						const message =
							error instanceof Error ? error.message : String(error);
						results.push({ shop, success: false, error: message });
					}
				}
				if (env.STORE_LOCATOR_STATUS) {
					await env.STORE_LOCATOR_STATUS.put(
						"store_locator_last_sync",
						JSON.stringify({
							lastSync: new Date().toISOString(),
							shopsProcessed: shops.length,
							results,
						}),
					);
				}
				return new Response(
					JSON.stringify({
						success: true,
						message: "Store locator updated for all shops",
						results,
					}),
					{ headers: { "Content-Type": "application/json" } },
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return new Response(
					JSON.stringify({ success: false, error: message }),
					{
						status: 500,
						headers: { "Content-Type": "application/json" },
					},
				);
			}
		}
		if (action === "status") {
			// Prefer persisted status if available
			let persistedStatus: any = null;
			if (env.STORE_LOCATOR_STATUS) {
				persistedStatus = await env.STORE_LOCATOR_STATUS.get(
					"store_locator_last_sync",
					{ type: "json" } as any,
				);
			}

			if (persistedStatus) {
				return new Response(JSON.stringify(persistedStatus), {
					headers: { "Content-Type": "application/json" },
				});
			}

			// Fall back to a live status snapshot so the endpoint is still useful
			try {
				const [dealers, shops] = await Promise.all([
					fetchAndTransformDealers(env).catch(() => null),
					getInstalledShops(env).catch(() => [] as string[]),
				]);

				const snapshot = {
					service: "store-locator",
					status: "idle",
					lastSync: null as string | null,
					shopsInstalled: Array.isArray(shops) ? shops.length : 0,
					dealersCount: Array.isArray(dealers) ? dealers.length : null,
					message: "No persisted sync status available",
				};

				return new Response(JSON.stringify(snapshot), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				return new Response(
					JSON.stringify({
						service: "store-locator",
						status: "unknown",
						error: message,
					}),
					{ headers: { "Content-Type": "application/json" } },
				);
			}
		}
		return new Response(JSON.stringify({ error: "Invalid action parameter" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error("Store locator API error:", error);
		return new Response(JSON.stringify({ error: "Internal server error" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
}

async function handleExperienceCenter(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!isFeatureEnabled(FEATURE_FLAGS, "ENABLE_EXPERIENCE_CENTER")) {
		return new Response("Experience center API disabled", { status: 503 });
	}
	try {
		const url = new URL(request.url);
		const action = url.searchParams.get("action");
		if (action === "trigger") {
			try {
				const result = await processExperienceCenterUpdateAllShops(env);
				if (env.EXPERIENCE_CENTER_STATUS) {
					await env.EXPERIENCE_CENTER_STATUS.put(
						"experience_center_last_sync",
						JSON.stringify(result),
					);
				}
				return new Response(JSON.stringify(result), {
					headers: { "Content-Type": "application/json" },
				});
			} catch (error) {
				const err = {
					success: false,
					timestamp: new Date().toISOString(),
					error: error instanceof Error ? error.message : String(error),
				};
				if (env.EXPERIENCE_CENTER_STATUS) {
					await env.EXPERIENCE_CENTER_STATUS.put(
						"experience_center_last_sync",
						JSON.stringify(err),
					);
				}
				return new Response(JSON.stringify(err), {
					status: 500,
					headers: { "Content-Type": "application/json" },
				});
			}
		}
		if (action === "status") {
			try {
				let statusData: any = null;
				if (env.EXPERIENCE_CENTER_STATUS) {
					const status = await env.EXPERIENCE_CENTER_STATUS.get(
						"experience_center_last_sync",
					);
					if (typeof status === "string" && status.length > 0) {
						statusData = JSON.parse(status);
					}
				}

				// Include a live probe to the EC upstream for quick visibility
				let totals: any = null;
				try {
					const ec = await fetchExperienceCenterData(env);
					totals = { total: ec.total };
				} catch (error) {
					// ignore live probe failures; expose as unavailable
				}

				if (statusData) {
					return new Response(
						JSON.stringify({
							service: "experience-center",
							status: "completed",
							lastRun: statusData.timestamp ?? null,
							result: statusData,
							woodApi: totals
								? { status: "available", totals }
								: { status: "unavailable" },
						}),
						{ headers: { "Content-Type": "application/json" } },
					);
				}

				// No persisted status; still return a meaningful snapshot
				return new Response(
					JSON.stringify({
						service: "experience-center",
						status: "idle",
						lastRun: null,
						woodApi: totals
							? { status: "available", totals }
							: { status: "unavailable" },
						message: "No persisted status available",
					}),
					{ headers: { "Content-Type": "application/json" } },
				);
			} catch (error) {
				const message =
					error instanceof Error ? error.message : "Unknown error";
				return new Response(
					JSON.stringify({
						service: "experience-center",
						status: "unknown",
						error: message,
					}),
					{ status: 500, headers: { "Content-Type": "application/json" } },
				);
			}
		}
		return new Response(JSON.stringify({ error: "Invalid action parameter" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error("Experience center API error:", error);
		return new Response(JSON.stringify({ error: "Internal server error" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
}

async function handleWebhooks(request: Request, env: Env): Promise<Response> {
	if (!isFeatureEnabled(FEATURE_FLAGS, "ENABLE_WEBHOOKS")) {
		return new Response("Webhooks API disabled", { status: 503 });
	}
	try {
		const topic = (request.headers.get("X-Shopify-Topic") || "").toLowerCase();
		if (topic === "app/uninstalled") {
			// app/uninstalled must use signature validation + cleanup
			const { handleAppUninstalled } = await import("./src/utils/webhooks");
			return handleAppUninstalled(request, env);
		}
		const url = new URL(request.url);
		const action = url.searchParams.get("action");
		if (action === "order" && request.method === "POST") {
			return handleOrderWebhook(request, env);
		}
		if (action === "test" && request.method === "POST") {
			const body = (await request.json().catch(() => ({}))) as any;
			const shop = (body.shop || "").toString();
			const accessToken = (body.accessToken || "").toString();
			if (!shop || !accessToken) {
				return new Response(
					JSON.stringify({
						success: false,
						error: "shop and accessToken required",
					}),
					{ status: 400, headers: { "Content-Type": "application/json" } },
				);
			}
			await registerWebhooks(shop, accessToken, env);
			return new Response(JSON.stringify({ success: true }), {
				headers: { "Content-Type": "application/json" },
			});
		}
		return new Response(JSON.stringify({ error: "Invalid action parameter" }), {
			status: 400,
			headers: { "Content-Type": "application/json" },
		});
	} catch (error) {
		console.error("Webhooks API error:", error);
		return new Response(JSON.stringify({ error: "Internal server error" }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
}

async function handleHealth(_request: Request, env: Env): Promise<Response> {
	const health = {
		status: "healthy",
		timestamp: new Date().toISOString(),
		features: FEATURE_FLAGS,
		environment: env.ENVIRONMENT || "development",
	};
	return new Response(JSON.stringify(health), {
		headers: { "Content-Type": "application/json" },
	});
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);
		const path = url.pathname;
		if (path.startsWith("/api/delivery-dates"))
			return handleDeliveryDates(request, env);
		if (path.startsWith("/api/store-locator"))
			return handleStoreLocator(request, env);
		if (path.startsWith("/api/experience-center"))
			return handleExperienceCenter(request, env);
		if (path.startsWith("/api/webhooks")) return handleWebhooks(request, env);
		if (path === "/health") return handleHealth(request, env);
		return requestHandler(request, { cloudflare: { env, ctx } });
	},

	async queue(batch, _env, _ctx): Promise<void> {
		for (const message of batch.messages) message.ack();
	},

	async scheduled(event: any, env: Env, _ctx: any): Promise<void> {
		// Store locator sync (every 6 hours)
		if (
			isFeatureEnabled(FEATURE_FLAGS, "ENABLE_STORE_LOCATOR") &&
			event.cron === "0 */6 * * *"
		) {
			try {
				const dealers = await fetchAndTransformDealers(env);
				const shops = await getInstalledShops(env);
				for (const shop of shops) {
					try {
						await upsertShopMetafield(env, dealers, shop);
					} catch {}
				}
				if (env.STORE_LOCATOR_STATUS) {
					await env.STORE_LOCATOR_STATUS.put(
						"store_locator_last_sync",
						JSON.stringify({
							lastSync: new Date().toISOString(),
							shopsProcessed: shops.length,
							success: true,
						}),
					);
				}
			} catch {}
		}

		// Experience center bulk operations (every 6h or daily at 04:00)
		if (
			isFeatureEnabled(FEATURE_FLAGS, "ENABLE_EXPERIENCE_CENTER") &&
			(event.cron === "0 */6 * * *" || event.cron === "0 4 * * *")
		) {
			try {
				const result = await processExperienceCenterUpdateAllShops(env);
				if (env.EXPERIENCE_CENTER_STATUS) {
					await env.EXPERIENCE_CENTER_STATUS.put(
						"experience_center_last_sync",
						JSON.stringify(result),
					);
				}
			} catch {}
		}

		// Token cleanup daily at 02:00
		if (event.cron === "0 2 * * *") {
			await cleanupOldTokens(env);
		}
	},
} satisfies ExportedHandler<Env, WebhookQueueMessage>;
