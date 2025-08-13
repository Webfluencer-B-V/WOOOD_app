export interface DealerApiConfig {
	baseUrl: string;
	apiKey: string;
}

export interface ShopifyAdminClient {
	request: (
		query: string,
		variables?: Record<string, unknown>,
	) => Promise<unknown>;
}

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

function mapExclusives(exclusivityData: unknown): string[] {
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

export async function fetchAndTransformDealers(
	config: DealerApiConfig,
): Promise<Array<Record<string, unknown>>> {
	const { baseUrl, apiKey } = config;
	if (!baseUrl || !apiKey) {
		throw new Error("Missing dealer API configuration (baseUrl or apiKey)");
	}
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Authorization: `Bearer ${apiKey}`,
	};
	// Normalize base URL: strip trailing slashes and any trailing /api
	const trimmed = baseUrl.replace(/\/+$/, "");
	const baseWithoutApi = trimmed.endsWith("/api")
		? trimmed.slice(0, -4)
		: trimmed;
	const response = await fetch(
		`${baseWithoutApi}/api/datasource/wooodshopfinder`,
		{
			headers,
		},
	);
	if (!response.ok) {
		throw new Error(
			`Failed to fetch dealers: ${response.status} ${response.statusText}`,
		);
	}
	const contentType = response.headers.get("content-type") || "";
	if (!contentType.includes("application/json")) {
		const textSample = (await response.text()).slice(0, 256);
		throw new Error(
			`Dealers endpoint returned non-JSON (content-type=${contentType}). Sample: ${textSample}`,
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
				accountmanager: _a,
				dealerActivationPortal: _dap,
				vatNumber: _v,
				shopfinderExclusives: _sfe,
				accountStatus: _as,
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
	adminClient: ShopifyAdminClient,
	dealers: Array<Record<string, unknown>>,
): Promise<{
	success: boolean;
	timestamp: string;
	count: number;
	upsertResult: unknown;
}> {
	const shopQuery = `query { shop { id } }`;
	const shopResult = (await adminClient.request(shopQuery)) as {
		data?: { shop?: { id?: string } };
	};
	const shopId = shopResult.data?.shop?.id;
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

	const upsertResult = await adminClient.request(mutation, variables);
	return {
		success: true,
		timestamp: new Date().toISOString(),
		count: dealers.length,
		upsertResult,
	};
}
