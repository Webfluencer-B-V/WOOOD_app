/// <reference types="vite/client" />

import { createRequestHandler, type ServerBuild } from "react-router";
import type {
	WorkerEnv as Env,
	FeatureFlags,
	QueueMessage,
	ScheduledJobMessage,
} from "./app/types/app";
import { DEFAULT_FEATURE_FLAGS, isFeatureEnabled } from "./src/config/flags";
import { createAdminClientForShop } from "./src/lib/admin";
import {
	fetchOmniaFeedData,
	processOmniaFeedWithBulkOperations,
} from "./src/utils/omniaFeed";
import {
	fetchAndTransformDealers,
	upsertShopMetafield,
} from "./src/utils/storeLocator";
import { handleDeliveryDates } from "./src/worker/handlers/deliveryDates";
import {
	handleExperienceCenter,
	runExperienceCenterForShop,
} from "./src/worker/handlers/experienceCenter";
import { handleStoreLocator } from "./src/worker/handlers/storeLocator";

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

// Use React Router virtual server-build via dynamic import of a string specifier
const serverBuildSpecifier: string = "virtual:react-router/server-build";
const requestHandler = createRequestHandler(
	() => import(serverBuildSpecifier) as unknown as Promise<ServerBuild>,
	"production",
);

// handlers moved to src/worker/handlers

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
		try {
			if (path.startsWith("/api/delivery-dates"))
				return handleDeliveryDates(request, env);
			if (path.startsWith("/api/store-locator"))
				return handleStoreLocator(request, env);
			if (path.startsWith("/api/experience-center"))
				return handleExperienceCenter(request, env);
			if (path.startsWith("/api/webhooks")) return handleWebhooks(request, env);
			if (path === "/health") return handleHealth(request, env);

			const response = await requestHandler(request, {
				cloudflare: { env, ctx },
			});
			// Only adjust headers for embedded app requests
			const isEmbedded = url.searchParams.get("embedded") === "1";
			if (!isEmbedded) return response;

			const headers = new Headers(response.headers);
			headers.delete("X-Frame-Options");
			const csp = headers.get("Content-Security-Policy");
			const frameAncestors =
				"frame-ancestors https://admin.shopify.com https://*.myshopify.com;";
			if (csp && /frame-ancestors/i.test(csp)) {
				const updated = csp
					.replace(/frame-ancestors[^;]*;/gi, frameAncestors)
					.trim();
				headers.set("Content-Security-Policy", updated);
			} else {
				const prefix = csp ? `${csp.trim()} ` : "";
				headers.set(
					"Content-Security-Policy",
					`${prefix}${frameAncestors}`.trim(),
				);
			}
			return new Response(response.body, {
				status: response.status,
				statusText: response.statusText,
				headers,
			});
		} catch (error) {
			console.error("Worker fetch error:", error);
			const message = error instanceof Error ? error.message : String(error);
			return new Response(
				`<!doctype html><html><body><h1>App Error</h1><pre>${message.slice(
					0,
					512,
				)}</pre></body></html>`,
				{
					status: 500,
					headers: { "Content-Type": "text/html;charset=utf-8" },
				},
			);
		}
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
						await runExperienceCenterForShop(body.shop, env);
						message.ack();
						break;
					}
					case "store-locator-sync": {
						if (!body.shop) throw new Error("Missing shop for SL job");
						const adminClient = await createAdminClientForShop(body.shop, env);
						const dealers = await fetchAndTransformDealers({
							baseUrl: env.DUTCH_FURNITURE_BASE_URL || "",
							apiKey: env.DUTCH_FURNITURE_API_KEY || "",
						});
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
					case "omnia-pricing-sync": {
						if (!body.shop)
							throw new Error("Missing shop for Omnia pricing job");
						const adminClient = await createAdminClientForShop(body.shop, env);
						const config = {
							feedUrl: env.OMNIA_FEED_URL || "",
							userAgent: "WOOOD-Shopify-Integration/1.0",
						};

						const validationConfig = {
							maxDiscountPercentage:
								Number(env.PRICING_MAX_DISCOUNT_PERCENTAGE) || 90,
							enforceBasePriceMatch:
								env.PRICING_ENFORCE_BASE_PRICE_MATCH !== "false",
							basePriceTolerance: Number(env.PRICING_BASE_PRICE_TOLERANCE) || 5,
							minPriceThreshold: 0.01,
							maxPriceThreshold: 10000,
						};

						const feedData = await fetchOmniaFeedData(config);
						const result = await processOmniaFeedWithBulkOperations(
							adminClient,
							feedData.products,
							validationConfig,
							body.shop,
							env.OMNIA_PRICING_HISTORY,
						);

						const status = {
							timestamp: new Date().toISOString(),
							success: true,
							runId: result.runId,
							triggeredBy: "cron" as const,
							summary: {
								...result,
								feedStats: {
									totalRows: feedData.totalRows,
									validRows: feedData.validRows,
									invalidRows: feedData.invalidRows,
								},
							},
							shop: body.shop,
							cron: true,
						};

						await env.OMNIA_PRICING_STATUS?.put(
							`omnia_last_sync:${body.shop}`,
							JSON.stringify(status),
						);

						// Optionally send email after successful cron sync
						if (
							env.EMAIL_PROVIDER === "cloudflare" &&
							env.OMNIA_EMAIL_RECIPIENTS
						) {
							try {
								const { sendOmniaReportEmail, parseEmailRecipients } =
									await import("./src/utils/email");
								const emailConfig = {
									provider: "cloudflare" as const,
									from: env.EMAIL_FROM || "noreply@woood.dev",
									recipients: parseEmailRecipients(env.OMNIA_EMAIL_RECIPIENTS),
									subjectPrefix: env.EMAIL_SUBJECT_PREFIX || "[WOOOD Cron] ",
								};

								await sendOmniaReportEmail(status, emailConfig);
								console.log("📧 Cron email sent successfully");
							} catch (emailError) {
								console.warn("Failed to send cron email:", emailError);
								// Don't fail the job if email fails
							}
						}
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
				const enabled = await env.WOOOD_KV?.get(
					`scheduler:enabled:store-locator:${shop}`,
				);
				if (enabled === "false") continue;
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
				const enabled = await env.WOOOD_KV?.get(
					`scheduler:enabled:experience-center:${shop}`,
				);
				if (enabled === "false") continue;
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

		if (
			isFeatureEnabled(FEATURE_FLAGS, "ENABLE_OMNIA_PRICING") &&
			event.cron === "0 4 * * *"
		) {
			for (const shop of shops) {
				const enabled = await env.WOOOD_KV?.get(
					`scheduler:enabled:omnia-pricing:${shop}`,
				);
				if (enabled === "false") continue;
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
					type: "omnia-pricing-sync",
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
