import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv } from "vite";
import i18nextLoader from "vite-plugin-i18next-loader";
import tsconfigPaths from "vite-tsconfig-paths";

import i18nextLoaderOptions from "./i18n.config.js";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");
	const rawBaseUrl = env.HOST ?? env.SHOPIFY_APP_URL;
	const app = rawBaseUrl ? new URL(rawBaseUrl) : null;

	// Determine Cloudflare environment
	const cloudflareEnv = env.APP_ENV || mode;
	const _isStaging = cloudflareEnv === "staging";
	const _isProduction = cloudflareEnv === "production";

	return {
		base: rawBaseUrl ?? "/",
		clearScreen: false,
		plugins: [
			i18nextLoader(i18nextLoaderOptions),
			cloudflare({
				viteEnvironment: { name: "ssr" },
			}),
			reactRouter(),
			tsconfigPaths(),
		],
		resolve: {
			mainFields: ["browser", "module", "main"],
		},
		server: app
			? {
					allowedHosts: [app.hostname],
					cors: { origin: true, preflightContinue: true },
					origin: app.origin,
					port: Number(env.PORT || 8080),
				}
			: {
					cors: { origin: true, preflightContinue: true },
					port: Number(env.PORT || 8080),
				},
		ssr: {
			resolve: {
				conditions: ["workerd", "worker", "browser"],
			},
		},
		// Environment-specific configuration
		define: {
			__CLOUDFLARE_ENV__: JSON.stringify(cloudflareEnv),
		},
	};
});
