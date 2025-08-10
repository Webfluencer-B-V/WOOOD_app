import type { AppLoadContext } from "@remix-run/cloudflare";

declare module "@remix-run/cloudflare" {
  interface AppLoadContext {
    cloudflare: {
      env: Record<string, any> & { DB: D1Database };
    };
  }
}

export function getLoadContext(args: any): AppLoadContext {
  return args.context;
}
