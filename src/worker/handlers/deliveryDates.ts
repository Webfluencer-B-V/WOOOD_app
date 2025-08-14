import type { WorkerEnv as Env } from "../../../app/types/app";
import { DEFAULT_FEATURE_FLAGS, isFeatureEnabled } from "../../config/flags";

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

export async function handleDeliveryDates(
	request: Request,
	env: Env,
): Promise<Response> {
	if (!isFeatureEnabled(DEFAULT_FEATURE_FLAGS, "ENABLE_DELIVERY_DATES_API")) {
		return new Response("Delivery dates API disabled", { status: 503 });
	}
	try {
		const url = new URL(request.url);
		const shop = url.searchParams.get("shop");
		if (!shop) return json({ error: "Shop parameter is required" }, 400);

		let accessToken: string | null = null;
		if (env.WOOOD_KV) {
			const tokenRecord = (await env.WOOOD_KV.get(
				`shop_token:${shop}`,
				"json",
			)) as {
				accessToken?: string;
			} | null;
			accessToken = tokenRecord?.accessToken || null;
		}
		if (!accessToken) return json({ dates: generateMockDates() });

		if (env.DUTCHNED_API_URL && env.DUTCHNED_API_KEY) {
			try {
				const response = await fetch(`${env.DUTCHNED_API_URL}/delivery-dates`, {
					headers: {
						Authorization: `Basic ${env.DUTCHNED_API_KEY}`,
						"Content-Type": "application/json",
					},
				});
				if (response.ok) return json(await response.json());
			} catch (_) {}
		}

		return json({ dates: generateMockDates() });
	} catch (_error) {
		return json({ error: "Internal server error" }, 500);
	}
}

function json(data: unknown, status = 200) {
	return new Response(JSON.stringify(data), {
		status,
		headers: { "Content-Type": "application/json" },
	});
}
