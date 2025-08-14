import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { createShopify } from "../shopify.server";

export async function loader({ request, context }: LoaderFunctionArgs) {
	try {
		const shopify = createShopify(context as unknown as any);
		const client = await shopify.admin(request);
		const shopResp = (await client.request(
			`query { shop { myshopifyDomain } }`,
		)) as { data?: { shop?: { myshopifyDomain?: string } } };
		const shop = shopResp?.data?.shop?.myshopifyDomain;
		if (!shop) {
			return new Response(JSON.stringify({ error: "Missing shop" }), {
				status: 401,
				headers: { "Content-Type": "application/json" },
			});
		}

		// Call Worker endpoint via internal URL; rely on Worker to fallback/mock
		const workerBase = (context as any)?.cloudflare?.env?.SHOPIFY_APP_URL || "";
		const url = new URL(`${workerBase}/api/delivery-dates`);
		url.searchParams.set("shop", shop);

		const res = await fetch(url.toString(), {
			headers: { Accept: "application/json" },
		});
		const contentType = res.headers.get("content-type") || "";
		if (!contentType.includes("application/json")) {
			const body = await res.text();
			return new Response(
				JSON.stringify({
					error: `Upstream not JSON (${res.status})`,
					body: body.slice(0, 256),
				}),
				{ status: 502, headers: { "Content-Type": "application/json" } },
			);
		}
		const data = await res.json();
		return new Response(JSON.stringify(data), {
			status: res.status,
			headers: { "Content-Type": "application/json" },
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
}

export async function action({ request, context }: ActionFunctionArgs) {
	// Mirror loader behavior for POST if needed
	return loader({ request, context } as unknown as LoaderFunctionArgs);
}
