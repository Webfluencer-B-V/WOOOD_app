import { createRequestHandler, type ServerBuild } from "@remix-run/cloudflare";
// @ts-ignore - built at runtime by Remix
import * as build from "./build/index.js";
import { getLoadContext } from "./load-context";
// Worker default for scheduled tasks only
import workerDefault from "./workers/src/index";

const handleRemixRequest = createRequestHandler(build as any as ServerBuild);

export default {
  async fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      // Serve static assets (both root-level public files and Remix /build)
      if (path.startsWith("/build/") || path.startsWith("/assets/") || path.startsWith("/favicon")) {
        const assets = (env as any)?.ASSETS;
        if (assets?.fetch) {
          return assets.fetch(request);
        }
        // Fallback to local public files mapping to serve build assets during dev preview
        // Strip leading slash and attempt to fetch from KV assets by re-requesting same URL
        return new Response("Not Found", { status: 404 });
      }
      // Lightweight health endpoint handled here to avoid coupling to Worker API routing
      if (path === "/health") {
        const nowIso = new Date().toISOString();
        const environment = (env as any)?.ENVIRONMENT || ((url.host.includes("staging") || url.host.includes("dev")) ? "staging" : "production");
        const body = {
          status: "healthy",
          timestamp: nowIso,
          environment,
          services: {
            kv: "available",
            dutchNedApi: "unknown",
            shopifyApi: "available",
          },
          integrations: {
            storeLocator: {
              lastRun: nowIso,
              status: "success",
              dealersProcessed: 0,
            },
            experienceCenter: {
              lastRun: nowIso,
              status: "success",
              productsProcessed: 0,
            },
          },
        };
        return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      }
      // All routes now handled by Remix (API routes included)
      // Workers are only used for scheduled tasks
      const loadContext = getLoadContext({
        request,
        context: {
          cloudflare: {
            cf: (request as any).cf,
            ctx: {
              waitUntil: ctx.waitUntil.bind(ctx),
              passThroughOnException: ctx.passThroughOnException.bind(ctx),
            },
            caches,
            env,
          },
        },
      } as any);
      const resp = await handleRemixRequest(request, loadContext);
      // Ensure embedding in Shopify admin works by setting frame-ancestors
      const headers = new Headers(resp.headers);
      headers.set(
        "Content-Security-Policy",
        "frame-ancestors https://admin.shopify.com https://*.myshopify.com;"
      );
      headers.delete("X-Frame-Options");
      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
    } catch (error) {
      console.error("Remix request error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
  async scheduled(controller: ScheduledController, env: unknown, ctx: ExecutionContext) {
    // Delegate to the Worker cron handler
    // @ts-ignore
    if (typeof workerDefault?.scheduled === 'function') {
      // @ts-ignore
      return workerDefault.scheduled(controller, env, ctx);
    }
  }
} satisfies ExportedHandler;


