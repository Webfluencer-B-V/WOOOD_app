import { Outlet } from "react-router";

import { Provider } from "~/components/proxy";
import { createShopify } from "~/shopify.server";
import type { Route } from "./+types/proxy";

export async function loader({ context, request }: Route.LoaderArgs) {
	try {
		const shopify = createShopify(context);
		shopify.utils.log.debug("proxy");

		await shopify.proxy(request);

		return { appUrl: shopify.config.appUrl };
		// biome-ignore lint/suspicious/noExplicitAny: catch(err)
	} catch (error: any) {
		const status = typeof error?.status === "number" ? error.status : 401;
		const message =
			typeof error?.message === "string" ? error.message : "Unauthorized";
		return new Response(message, {
			status,
			statusText: "Unauthorized",
		});
	}
}

export default function ProxyRoute({ loaderData }: Route.ComponentProps) {
	const { appUrl } = loaderData ?? {};

	return (
		<Provider appUrl={appUrl}>
			<Outlet />
		</Provider>
	);
}
