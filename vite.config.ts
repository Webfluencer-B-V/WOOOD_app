import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import { defineConfig, loadEnv } from "vite";
import i18nextLoader from "vite-plugin-i18next-loader";
import tsconfigPaths from "vite-tsconfig-paths";

import i18nextLoaderOptions from "./i18n.config";

export default defineConfig(({ mode }) => {
	const env = loadEnv(mode, process.cwd(), "");

	const rawAppUrl = env.SHOPIFY_APP_URL;
	let app: URL;
	if (!rawAppUrl) {
		// Fall back to localhost in environments (like CI) where SHOPIFY_APP_URL is not provided
		// This keeps build tools working without requiring deployment URL configuration
		console.warn(
			"[vite] SHOPIFY_APP_URL is not set; falling back to http://localhost:8080",
		);
		app = new URL("http://localhost:8080");
	} else {
		try {
			app = new URL(rawAppUrl);
		} catch (_error) {
			throw new Error(`Invalid SHOPIFY_APP_URL: ${rawAppUrl}`);
		}
	}

	return {
		base: "/",
		clearScreen: false,
		plugins: [
			i18nextLoader(i18nextLoaderOptions),
			cloudflare({ viteEnvironment: { name: "ssr" } }),
			reactRouter(),
			tsconfigPaths(),
		],
		resolve: {
			mainFields: ["browser", "module", "main"],
		},
		server: {
			allowedHosts: [app.hostname],
			cors: {
				origin: true,
				preflightContinue: true,
			},
			origin: app.origin,
			port: Number(env.PORT || 8080),
		},
		ssr: {
			resolve: {
				conditions: ["workerd", "worker", "browser"],
			},
		},
	};
});
