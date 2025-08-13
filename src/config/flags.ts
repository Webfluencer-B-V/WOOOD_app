import type { FeatureFlags } from "../../app/types/app";

export const DEFAULT_FEATURE_FLAGS: FeatureFlags = {
	ENABLE_DELIVERY_DATES_API: true,
	ENABLE_STORE_LOCATOR: true,
	ENABLE_EXPERIENCE_CENTER: true,
	ENABLE_WEBHOOKS: true,
};

export function isFeatureEnabled(
	flags: FeatureFlags,
	feature: keyof FeatureFlags,
): boolean {
	return flags[feature] === true;
}

export type { FeatureFlags };
