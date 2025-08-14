import type { WorkerEnv as Env } from "../../../app/types/app";
import { DEFAULT_FEATURE_FLAGS, isFeatureEnabled } from "../../config/flags";
import { createAdminClientForShop } from "../../lib/admin";
import {
	fetchExperienceCenterData,
	processExperienceCenterWithBulkOperations,
} from "../../utils/experienceCenter";

export async function handleExperienceCenter(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!isFeatureEnabled(DEFAULT_FEATURE_FLAGS, "ENABLE_EXPERIENCE_CENTER")) {
		return new Response("Experience center API disabled", { status: 503 });
	}
	const url = new URL(request.url);
	const action = url.searchParams.get("action");
	if (action === "trigger") {
		try {
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
			return json({ success: true, enqueued: shops.length });
		} catch (error) {
			const err = {
				success: false,
				timestamp: new Date().toISOString(),
				error: error instanceof Error ? error.message : String(error),
			};
			if (env.EXPERIENCE_CENTER_STATUS)
				await env.EXPERIENCE_CENTER_STATUS.put(
					"experience_center_last_sync",
					JSON.stringify(err),
				);
			return json(err, 500);
		}
	}
	if (action === "status") {
		try {
			let statusData: { timestamp?: string } | null = null;
			if (env.EXPERIENCE_CENTER_STATUS) {
				const status = await env.EXPERIENCE_CENTER_STATUS.get(
					"experience_center_last_sync",
				);
				if (typeof status === "string" && status.length > 0)
					statusData = JSON.parse(status);
			}
			let totals: { total: number } | null = null;
			try {
				const ec = await fetchExperienceCenterData({
					baseUrl: env.DUTCH_FURNITURE_BASE_URL || "",
					apiKey: env.DUTCH_FURNITURE_API_KEY || "",
				});
				totals = { total: ec.total };
			} catch (_) {}
			if (statusData)
				return json({
					service: "experience-center",
					status: "completed",
					lastRun: statusData.timestamp ?? null,
					result: statusData,
					woodApi: totals
						? { status: "available", totals }
						: { status: "unavailable" },
				});
			return json(
				{ error: "Deprecated. Use app action status in dashboard." },
				410,
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : "Unknown error";
			return json(
				{ service: "experience-center", status: "unknown", error: message },
				500,
			);
		}
	}
	return json({ error: "Invalid action parameter" }, 400);
}

export async function runExperienceCenterForShop(shop: string, env: Env) {
	const adminClient = await createAdminClientForShop(shop, env);
	const ec = await fetchExperienceCenterData({
		baseUrl: env.DUTCH_FURNITURE_BASE_URL || "",
		apiKey: env.DUTCH_FURNITURE_API_KEY || "",
	});
	const availableEans = new Set(
		ec.data
			.map((i: { ean?: string }) => i.ean)
			.filter(
				(ean): ean is string => typeof ean === "string" && ean.length > 0,
			),
	);
	const result = await processExperienceCenterWithBulkOperations(
		adminClient,
		availableEans,
	);
	await env.EXPERIENCE_CENTER_STATUS?.put(
		`ec_last_sync:${shop}`,
		JSON.stringify({
			timestamp: new Date().toISOString(),
			success: true,
			summary: { ...result, sourceTotal: ec.total },
			shop,
			cron: true,
		}),
	);
}

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
