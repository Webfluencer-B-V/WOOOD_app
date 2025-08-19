import {
	index,
	layout,
	prefix,
	type RouteConfig,
	route,
} from "@react-router/dev/routes";

export default [
	// Main entry point - handles authentication and redirects to app
	index("routes/index.tsx"),

	// Main app routes - authenticated area
	...prefix("app", [
		layout("./routes/app.tsx", [index("routes/app.index.tsx")]),
	]),

	// App proxy routes for storefront features
	...prefix("apps/:subpath", [
		layout("./routes/proxy.tsx", [index("./routes/proxy.index.tsx")]),
	]),

	// Shopify-specific routes
	...prefix("shopify", [
		...prefix("auth", [
			route("login", "./routes/shopify.auth.login.tsx"),
			route(
				"session-token-bounce",
				"./routes/shopify.auth.session-token-bounce.tsx",
			),
		]),
		route("webhooks", "./routes/shopify.webhooks.tsx"),
	]),
] satisfies RouteConfig;
