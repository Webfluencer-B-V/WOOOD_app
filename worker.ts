/// <reference types="vite/client" />

import { createRequestHandler } from "react-router";
import type {
	WorkerEnv as Env,
	FeatureFlags,
	QueueMessage,
	ScheduledJobMessage,
} from "./app/types/app";
import { DEFAULT_FEATURE_FLAGS, isFeatureEnabled } from "./src/config/flags";
import {
	type ExperienceCenterApiConfig,
	fetchExperienceCenterData,
	processExperienceCenterWithBulkOperations,
} from "./src/utils/experienceCenter";
import {
	type DealerApiConfig,
	fetchAndTransformDealers,
	upsertShopMetafield,
} from "./src/utils/storeLocator";

// Webhook processing is handled in app routes; worker enqueues and scheduled jobs only

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
	// virtual module injected by build tool
	() => import("virtual:react-router/server-build"),
	"production",
);

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

// Helper: create a Shopify Admin client for a given shop using offline token from KV
async function createAdminClientForShop(shop: string, env: Env) {
	const record = (await env.WOOOD_KV?.get(`shop_token:${shop}`, "json")) as {
		accessToken?: string;
	} | null;
	const accessToken = record?.accessToken;
	if (!accessToken) throw new Error(`No access token for shop ${shop}`);

	return {
		request: async (query: string, variables?: Record<string, unknown>) => {
			const response = await fetch(
				`https://${shop}/admin/api/2023-10/graphql.json`,
				{
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						"X-Shopify-Access-Token": accessToken,
					},
					body: JSON.stringify({ query, variables }),
				},
			);
			const json = await response.json();
			if (!response.ok) {
				throw new Error(
					`GraphQL error ${response.status}: ${JSON.stringify(json)}`,
				);
			}
			return json;
		},
	};
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
			const tokenRecord = (await env.WOOOD_KV.get(
				`shop_token:${shop}`,
				"json",
			)) as { accessToken?: string } | null;
			accessToken = tokenRecord?.accessToken || null;
		}
		if (!accessToken) {
			const mockDates = generateMockDates();
			return new Response(JSON.stringify({ dates: mockDates }), {
				headers: { "Content-Type": "application/json" },
			});
		}
		if (env.DUTCHNED_API_URL && env.DUTCHNED_API_KEY) {
			try {
				const response = await fetch(`${env.DUTCHNED_API_URL}/delivery-dates`, {
					headers: {
						Authorization: `Basic ${env.DUTCHNED_API_KEY}`,
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
				const dealers = await fetchAndTransformDealers({
					baseUrl: env.DUTCH_FURNITURE_BASE_URL || "",
					apiKey: env.DUTCH_FURNITURE_API_KEY || "",
				});
				const keys = await env.WOOOD_KV?.list({ prefix: "shop_token:" });
				const shops =
					keys?.keys?.map((k) => k.name.replace("shop_token:", "")) || [];
				const results: Array<{
					shop: string;
					success?: boolean;
					error?: string;
					[key: string]: unknown;
				}> = [];
				for (const shop of shops) {
					try {
						const adminClient = await createAdminClientForShop(shop, env);
						const result = await upsertShopMetafield(adminClient, dealers);
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
			return new Response(
				JSON.stringify({
					error: "Deprecated. Use app action status in dashboard.",
				}),
				{ status: 410, headers: { "Content-Type": "application/json" } },
			);
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
				// Enqueue per-shop jobs instead of processing inline
				const keys = await env.WOOOD_KV?.list({ prefix: "shop_token:" });
				const shops =
					keys?.keys?.map((k) => k.name.replace("shop_token:", "")) || [];
				for (const shop of shops) {
					await (
						env as unknown as {
							SCHEDULED_QUEUE?: {
								send: (m: {
									type: string;
									shop?: string;
									scheduledAt: string;
								}) => Promise<void>;
							};
						}
					).SCHEDULED_QUEUE?.send({
						type: "experience-center-sync",
						shop,
						scheduledAt: new Date().toISOString(),
					});
				}
				return new Response(
					JSON.stringify({ success: true, enqueued: shops.length }),
					{ headers: { "Content-Type": "application/json" } },
				);
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
				let statusData: { timestamp?: string } | null = null;
				if (env.EXPERIENCE_CENTER_STATUS) {
					const status = await env.EXPERIENCE_CENTER_STATUS.get(
						"experience_center_last_sync",
					);
					if (typeof status === "string" && status.length > 0) {
						statusData = JSON.parse(status);
					}
				}

				// Include a live probe to the EC upstream for quick visibility
				let totals: { total: number } | null = null;
				try {
					const ec = await fetchExperienceCenterData({
						baseUrl: env.DUTCH_FURNITURE_BASE_URL || "",
						apiKey: env.DUTCH_FURNITURE_API_KEY || "",
					});
					totals = { total: ec.total };
				} catch (_error) {
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

				// Deprecated endpoint behavior
				return new Response(
					JSON.stringify({
						error: "Deprecated. Use app action status in dashboard.",
					}),
					{ status: 410, headers: { "Content-Type": "application/json" } },
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

async function handleWebhooks(_request: Request, _env: Env): Promise<Response> {
	// Deprecated: Webhooks intake is handled by app route `app/routes/shopify.webhooks.tsx`
	return new Response(
		JSON.stringify({
			error: "Deprecated. Use app route /shopify.webhooks.",
		}),
		{ status: 410, headers: { "Content-Type": "application/json" } },
	);
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

	// Strongly-typed minimal queue batch type compatible with Workers
	// without relying on external type packages
	async queue(
		batch: { messages: Array<{ ack: () => void }> },
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		for (const message of batch.messages) {
			try {
				const body = (message as unknown as { body?: QueueMessage }).body as
					| ScheduledJobMessage
					| undefined;

				if (!body || !("type" in body)) {
					// Not a scheduled job, ack (webhook queue is handled by app route)
					message.ack();
					continue;
				}

				switch (body.type) {
					case "experience-center-sync": {
						if (!body.shop) throw new Error("Missing shop for EC job");
						const adminClient = await createAdminClientForShop(body.shop, env);
						const config: ExperienceCenterApiConfig = {
							baseUrl: env.DUTCH_FURNITURE_BASE_URL || "",
							apiKey: env.DUTCH_FURNITURE_API_KEY || "",
						};
						const ec = await fetchExperienceCenterData(config);
						const availableEans = new Set(
							ec.data
								.map((i: { ean?: string }) => i.ean)
								.filter(
									(ean): ean is string =>
										typeof ean === "string" && ean.length > 0,
								),
						);
						const result = await processExperienceCenterWithBulkOperations(
							adminClient,
							availableEans,
						);
						await env.EXPERIENCE_CENTER_STATUS?.put(
							`ec_last_sync:${body.shop}`,
							JSON.stringify({
								timestamp: new Date().toISOString(),
								success: true,
								summary: result,
								shop: body.shop,
								cron: true,
							}),
						);
						message.ack();
						break;
					}
					case "store-locator-sync": {
						if (!body.shop) throw new Error("Missing shop for SL job");
						const adminClient = await createAdminClientForShop(body.shop, env);
						const config: DealerApiConfig = {
							baseUrl: env.DUTCH_FURNITURE_BASE_URL || "",
							apiKey: env.DUTCH_FURNITURE_API_KEY || "",
						};
						const dealers = await fetchAndTransformDealers(config);
						await upsertShopMetafield(adminClient, dealers);
						await env.STORE_LOCATOR_STATUS?.put(
							`sl_last_sync:${body.shop}`,
							JSON.stringify({
								timestamp: new Date().toISOString(),
								success: true,
								count: dealers.length,
								shop: body.shop,
								cron: true,
							}),
						);
						message.ack();
						break;
					}
					case "token-cleanup": {
						// Legacy no-op: token cleanup handled by app flows
						message.ack();
						break;
					}
				}
			} catch (error) {
				console.error("Queue job failed", error);
				const maybeRetry = (message as unknown as { retry?: () => void }).retry;
				if (typeof maybeRetry === "function") maybeRetry();
				else message.ack();
			}
		}
	},

	async scheduled(
		event: { cron?: string },
		env: Env,
		_ctx: ExecutionContext,
	): Promise<void> {
		// Enqueue jobs instead of executing inline
		const keys = await env.WOOOD_KV?.list({ prefix: "shop_token:" });
		const shops =
			keys?.keys?.map((k) => k.name.replace("shop_token:", "")) || [];

		if (
			isFeatureEnabled(FEATURE_FLAGS, "ENABLE_STORE_LOCATOR") &&
			event.cron === "0 */6 * * *"
		) {
			for (const shop of shops) {
				await (
					env as unknown as {
						SCHEDULED_QUEUE?: {
							send: (m: {
								type: string;
								shop?: string;
								scheduledAt: string;
							}) => Promise<void>;
						};
					}
				).SCHEDULED_QUEUE?.send({
					type: "store-locator-sync",
					shop,
					scheduledAt: new Date().toISOString(),
				});
			}
		}

		if (
			isFeatureEnabled(FEATURE_FLAGS, "ENABLE_EXPERIENCE_CENTER") &&
			(event.cron === "0 */6 * * *" || event.cron === "0 4 * * *")
		) {
			for (const shop of shops) {
				await (
					env as unknown as {
						SCHEDULED_QUEUE?: {
							send: (m: {
								type: string;
								shop?: string;
								scheduledAt: string;
							}) => Promise<void>;
						};
					}
				).SCHEDULED_QUEUE?.send({
					type: "experience-center-sync",
					shop,
					scheduledAt: new Date().toISOString(),
				});
			}
		}

		if (event.cron === "0 2 * * *") {
			await (
				env as unknown as {
					SCHEDULED_QUEUE?: {
						send: (m: {
							type: string;
							shop?: string;
							scheduledAt: string;
						}) => Promise<void>;
					};
				}
			).SCHEDULED_QUEUE?.send({
				type: "token-cleanup",
				scheduledAt: new Date().toISOString(),
			});
		}
	},
} satisfies ExportedHandler<Env, QueueMessage>;
