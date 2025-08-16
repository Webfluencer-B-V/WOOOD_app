import { NavMenu, useAppBridge } from "@shopify/app-bridge-react";
import { AppProvider, type AppProviderProps } from "@shopify/polaris";
import polarisCss from "@shopify/polaris/build/esm/styles.css?url";
import type { LinkLikeComponentProps } from "@shopify/polaris/build/ts/src/utilities/link";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, Outlet, useNavigation } from "react-router";
import { createShopify } from "~/shopify.server";
import { APP_BRIDGE_URL } from "../const";
import type { Route } from "./+types/app";

export async function loader({ context, request }: Route.LoaderArgs) {
	try {
		const shopify = createShopify(context);
		shopify.utils.log.debug("app");

		await shopify.admin(request);

		return {
			appDebug: shopify.config.appLogLevel === "debug",
			appHandle: shopify.config.appHandle,
			apiKey: shopify.config.apiKey,
			appUrl: shopify.config.appUrl,
		};
		// biome-ignore lint/suspicious/noExplicitAny: catch(err)
	} catch (error: any) {
		if (error instanceof Response) return error;

		return new Response(error.message, {
			status: error.status,
			statusText: "Unauthorized",
		});
	}
}

export default function App({ loaderData }: Route.ComponentProps) {
	const { apiKey } = loaderData;

	const { t } = useTranslation(["app", "polaris"]);
	const i18n = {
		Polaris: t("Polaris", {
			ns: "polaris",
			returnObjects: true,
		}),
	} as AppProviderProps["i18n"];

	return (
		<>
			<script data-api-key={apiKey} src={APP_BRIDGE_URL} />

			<AppProvider i18n={i18n} linkComponent={LinkComponent}>
				<NavMenu>
					<Link rel="home" to="/app">
						{t("app")}
					</Link>
					<Link to="/app?section=experience-center">EC</Link>
					<Link to="/app?section=store-locator">Store Locator</Link>
					<Link to="/app?section=omnia">Omnia Pricing</Link>
				</NavMenu>

				<AppOutlet />
			</AppProvider>
		</>
	);
}

function AppOutlet() {
	const shopify = useAppBridge();
	const navigation = useNavigation();
	const isNavigating = navigation.state !== "idle" || !!navigation.location;
	useEffect(() => {
		shopify.loading(isNavigating);
	}, [isNavigating, shopify]);

	return <Outlet />;
}

export function ErrorBoundary(error: Route.ErrorBoundaryProps) {
	if (
		error.constructor.name === "ErrorResponse" ||
		error.constructor.name === "ErrorResponseImpl"
	) {
		return (
			<div
				// biome-ignore lint/security/noDangerouslySetInnerHtml: framework
				dangerouslySetInnerHTML={{
					// biome-ignore lint/suspicious/noExplicitAny: upsteam
					__html: (error as any).data || "Handling response",
				}}
			/>
		);
	}

	throw error;
}
ErrorBoundary.displayName = "AppErrorBoundary";

export function headers({
	parentHeaders,
	loaderHeaders,
	actionHeaders,
	errorHeaders,
}: Route.HeadersArgs) {
	if (errorHeaders && Array.from(errorHeaders.entries()).length > 0) {
		return errorHeaders;
	}

	const headers = new Headers();

	if (parentHeaders) {
		for (const [key, value] of parentHeaders.entries())
			headers.append(key, value);
	}
	if (loaderHeaders) {
		for (const [key, value] of loaderHeaders.entries())
			headers.append(key, value);
	}
	if (actionHeaders) {
		for (const [key, value] of actionHeaders.entries())
			headers.append(key, value);
	}

	return headers;
}

function LinkComponent({ url, ...props }: LinkLikeComponentProps) {
	return <Link viewTransition {...props} to={url} suppressHydrationWarning />;
}

export const links: Route.LinksFunction = () => [
	{ href: "https://cdn.shopify.com", rel: "preconnect" },
	{ as: "script", href: APP_BRIDGE_URL, rel: "preload" },
	{
		href: "https://cdn.shopify.com/static/fonts/inter/v4/styles.css",
		precedence: "default",
		rel: "stylesheet",
	},
	{ href: polarisCss, precedence: "high", rel: "stylesheet" },
];

export const meta: Route.MetaFunction = ({ data }: Route.MetaArgs) => [
	data?.appDebug ? { name: "shopify-debug", content: "web-vitals" } : {},
	{ name: "shopify-experimental-features", content: "keepAlive" },
];
