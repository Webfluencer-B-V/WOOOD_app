import { defineConfig } from "@remix-run/dev";

export default defineConfig({
  serverModule: "@remix-run/cloudflare",
  serverBuildPath: "build/index.js",
  future: {
    v3_fetcherPersist: true,
    v3_relativeSplatPath: true, 
    v3_throwAbortReason: true,
    v3_singleFetch: true,
    v3_lazyRouteDiscovery: true,
  },
});
