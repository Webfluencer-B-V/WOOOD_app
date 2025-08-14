import type { WorkerEnv as Env } from "../../../app/types/app";
import { DEFAULT_FEATURE_FLAGS, isFeatureEnabled } from "../../config/flags";
import { createAdminClientForShop } from "../../lib/admin";
import {
	fetchAndTransformDealers,
	upsertShopMetafield,
} from "../../utils/storeLocator";

export async function handleStoreLocator(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!isFeatureEnabled(DEFAULT_FEATURE_FLAGS, "ENABLE_STORE_LOCATOR")) {
		return new Response("Store locator API disabled", { status: 503 });
	}
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
				[k: string]: unknown;
			}> = [];
			for (const shop of shops) {
				try {
					const adminClient = await createAdminClientForShop(shop, env);
					const result = (await upsertShopMetafield(
						adminClient,
						dealers,
					)) as Record<string, unknown>;
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
			return json({
				success: true,
				message: "Store locator updated for all shops",
				results,
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return json({ success: false, error: message }, 500);
		}
	}
	if (action === "status") {
		return json(
			{ error: "Deprecated. Use app action status in dashboard." },
			410,
		);
	}
	return json({ error: "Invalid action parameter" }, 400);
}

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
