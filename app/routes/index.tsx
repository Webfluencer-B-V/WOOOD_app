import { redirect } from "react-router";

import type { Route } from "./+types/index";

export async function loader({ request }: Route.LoaderArgs) {
	const url = new URL(request.url);

	// if Shopify context params are present, hand off to
	const contextParams = ["shop", "host", "embedded", "id_token", "session"];
	const hasShopifyContext = contextParams.some((p) => url.searchParams.has(p));
	if (hasShopifyContext) {
		return redirect(`/app?${url.searchParams.toString()}`);
	}

	const data = { ok: true };
	return { data };
}

export default function Index() {
	return (
		<div
			style={{
				alignItems: "center",
				display: "flex",
				height: "100vh",
				justifyContent: "center",
				width: "100vw",
			}}
		>
			<h1 data-testid="h1">WOOOD</h1>
		</div>
	);
}

export async function action(_: Route.ActionArgs) {
	const data = { ok: true };
	return { data };
}
