import { env } from "node:process";
import { defineConfig } from "@playwright/test";

const isCI = env.CI === "true" || env.CI === "1";
const appUrl = env.SHOPIFY_APP_URL;

const config = defineConfig(
	isCI
		? {
				testDir: "./",
				testMatch: /a^/,
			}
		: {
				outputDir: "node_modules/.playwright",
				testDir: "./",
				testMatch: /.*\.e2e\.test\.ts/,
				use: {
					baseURL: appUrl,
					extraHTTPHeaders: {
						Accept: "application/json",
						// Authorization: `token ${env.SHOPIFY_STOREFRONT_ACCESS_TOKEN}`,
					},
					locale: "en",
					serviceWorkers: "allow",
				},
				webServer: {
					command: "npm run dev:tunnel",
					reuseExistingServer: true,
					timeout: 10 * 1000,
					url: appUrl,
				},
			},
);

export default config;
