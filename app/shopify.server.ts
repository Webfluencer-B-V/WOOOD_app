import '@shopify/shopify-app-remix/adapters/node';
import { ApiVersion, shopifyApp } from '@shopify/shopify-app-remix/server';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getDb } from './db.server';
import { D1SessionStorage } from './session/D1SessionStorage';

export const shopify = (context: LoaderFunctionArgs['context']) => {
  const env = (context as any)?.cloudflare?.env as Record<string, string> & { DB: D1Database };
  const db = getDb(env.DB);
  const sessionStorage = new D1SessionStorage(db);

  return shopifyApp({
    isEmbeddedApp: true,
    apiKey: env.SHOPIFY_API_KEY || env.SHOPIFY_APP_CLIENT_ID,
    apiSecretKey: env.SHOPIFY_API_SECRET || env.SHOPIFY_APP_CLIENT_SECRET,
    appUrl: env.SHOPIFY_APP_URL,
    scopes: (env.SCOPES || 'read_products').split(','),
    apiVersion: ApiVersion.October24,
    future: { unstable_newEmbeddedAuthStrategy: true },
    sessionStorage: {
      storeSession: (s) => sessionStorage.storeSession(s),
      loadSession: (id) => sessionStorage.loadSession(id),
      deleteSession: (id) => sessionStorage.deleteSession(id),
      deleteSessions: (ids) => sessionStorage.deleteSessions(ids),
      findSessionsByShop: async () => [],
    },
  });
};

export default shopify;


