import type { AppLoadContext, EntryContext } from "@remix-run/cloudflare";
import { RemixServer } from "@remix-run/react";
import { isbot } from "isbot";
import { renderToReadableStream } from "react-dom/server";

const ABORT_DELAY = 5000;

export default async function handleRequest(
  request: Request,
  status: number,
  headers: Headers,
  remixContext: EntryContext,
  _loadContext: AppLoadContext
) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ABORT_DELAY);

  try {
    const body = await renderToReadableStream(
      <RemixServer context={remixContext} url={request.url} abortDelay={ABORT_DELAY} />,
      { signal: controller.signal }
    );

    body.allReady.then(() => clearTimeout(timeoutId));

    if (isbot(request.headers.get("user-agent") || "")) {
      await body.allReady;
    }

    headers.set("Content-Type", "text/html");
    return new Response(body, { status, headers });
  } catch (error) {
    clearTimeout(timeoutId);
    return new Response("Internal Server Error", { status: 500 });
  }
}


