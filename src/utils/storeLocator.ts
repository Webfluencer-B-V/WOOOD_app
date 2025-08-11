import type { Env } from "./consolidation";

const EXCLUSIVITY_MAP: Record<string, string> = {
	"woood essentials": "WOOOD Essentials",
	essentials: "WOOOD Essentials",
	"woood premium": "WOOOD Premium",
	"woood exclusive": "WOOOD Premium",
	"woood outdoor": "WOOOD Outdoor",
	"woood tablo": "WOOOD Tablo",
	vtwonen: "vtwonen",
	"vt wonen dealers only": "vtwonen",
};

function mapExclusives(exclusivityData: any): string[] {
	if (!exclusivityData) return [];
	let descriptions: string[] = [];
	if (Array.isArray(exclusivityData)) {
		descriptions = exclusivityData
			.map((item) => {
				const desc = item.Description || item.description;
				return typeof desc === "string" ? desc.trim().toLowerCase() : null;
			})
			.filter((d): d is string => d !== null);
	} else if (typeof exclusivityData === "string") {
		descriptions = exclusivityData
			.split(",")
			.map((val) => val.trim().toLowerCase());
	}
	const mapped = descriptions
		.map((desc) => EXCLUSIVITY_MAP[desc])
		.filter((val): val is string => Boolean(val));
	return [...new Set(mapped)];
}

async function getShopAccessToken(
	env: Env,
	shop: string,
): Promise<string | null> {
	if (!env.WOOOD_KV) return null;
	const tokenRecord = (await env.WOOOD_KV.get(
		`shop_token:${shop}`,
		"json",
	)) as any;
	return tokenRecord?.accessToken || null;
}

export async function fetchAndTransformDealers(env: Env): Promise<any[]> {
	if (!env.DUTCH_FURNITURE_BASE_URL || !env.DUTCH_FURNITURE_API_KEY) {
		throw new Error("Missing Dutch Furniture API configuration");
	}
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${env.DUTCH_FURNITURE_API_KEY}`,
	};
	const response = await fetch(`${env.DUTCH_FURNITURE_BASE_URL}/dealers`, {
		headers,
	});
	if (!response.ok) {
		throw new Error(
			`Failed to fetch dealers: ${response.status} ${response.statusText}`,
		);
	}
	const data = await response.json();
	if (!Array.isArray(data)) {
		throw new Error("Dutch Furniture API did not return an array");
	}
	return data
		.filter((dealer) => {
			const accountStatus = dealer.accountStatus || dealer.AccountStatus;
			const activationPortal =
				dealer.dealerActivationPortal || dealer.DealerActivationPortal;
			const isActivated =
				activationPortal === true || activationPortal === "WAAR";
			return accountStatus === "A" && isActivated;
		})
		.map((dealer) => {
			const {
				accountmanager,
				dealerActivationPortal,
				vatNumber,
				shopfinderExclusives,
				accountStatus,
				...rest
			} = dealer;
			const exclusivityRaw =
				dealer.Exclusiviteit ||
				dealer.shopfinderExclusives ||
				dealer.ShopfinderExclusives;
			const exclusives = mapExclusives(exclusivityRaw);
			const name =
				dealer.nameAlias || dealer.NameAlias || dealer.name || dealer.Name;
			return { ...rest, name, exclusives };
		});
}

export async function upsertShopMetafield(
	env: Env,
	dealers: any[],
	shop: string,
): Promise<any> {
	const accessToken = await getShopAccessToken(env, shop);
	if (!accessToken) throw new Error(`No access token found for shop: ${shop}`);
	const shopQuery = `query { shop { id } }`;
	const shopResponse = await fetch(
		`https://${shop}/admin/api/2023-10/graphql.json`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Shopify-Access-Token": accessToken,
			},
			body: JSON.stringify({ query: shopQuery }),
		},
	);
	const shopResult = (await shopResponse.json()) as {
		data?: { shop?: { id?: string } };
	};
	const shopId = shopResult?.data?.shop?.id;
	if (!shopId) throw new Error("Could not fetch shop ID");
	const mutation = `
		mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
			metafieldsSet(metafields: $metafields) {
				metafields { key namespace value type ownerType }
				userErrors { field message }
			}
		}
	`;
	const variables = {
		metafields: [
			{
				ownerId: shopId,
				namespace: "woood",
				key: "store_locator",
				value: JSON.stringify(dealers),
				type: "json",
			},
		],
	};
	const upsertResponse = await fetch(
		`https://${shop}/admin/api/2023-10/graphql.json`,
		{
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Shopify-Access-Token": accessToken,
			},
			body: JSON.stringify({ query: mutation, variables }),
		},
	);
	const upsertResult = await upsertResponse.json();
	return {
		success: true,
		timestamp: new Date().toISOString(),
		count: dealers.length,
		upsertResult,
	};
}
