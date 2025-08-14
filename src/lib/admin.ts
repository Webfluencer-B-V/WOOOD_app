import type { WorkerEnv as Env } from "../../app/types/app";

export async function createAdminClientForShop(shop: string, env: Env) {
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
