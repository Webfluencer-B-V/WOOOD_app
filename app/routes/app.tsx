import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { Outlet, useLoaderData } from '@remix-run/react';
// Remove App Bridge React provider to avoid SSR invalid element errors
import { AppProvider as PolarisProvider } from '@shopify/polaris';
import { json } from '@remix-run/cloudflare';
import { shopify } from '~/shopify.server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    console.log('[App Loader] Starting authentication...');
    await shopify(context).authenticate.admin(request);
    console.log('[App Loader] Authentication successful');

    const url = new URL(request.url);
    const shop = url.searchParams.get('shop') || '';
    const host = url.searchParams.get('host') || '';
    const env = (context as any)?.cloudflare?.env as Record<string, string>;

    const apiKey = env.SHOPIFY_API_KEY || env.SHOPIFY_APP_CLIENT_ID || '';

    console.log('[App Loader] Config:', { shop, host, hasApiKey: !!apiKey });

    const envVars = (context as any)?.cloudflare?.env as Record<string, string>;

    return json({
      apiKey,
      host,
      shop,
      version: envVars.APP_VERSION || 'dev',
    });
  } catch (error) {
    console.error('[App Loader] Error:', error);
    if (error instanceof Response) {
      // Allow Shopify auth helper to redirect properly instead of returning 500
      throw error;
    }
    throw new Response(
      `Authentication failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { status: 500, statusText: 'Authentication Error' }
    );
  }
}

// Enhanced Polaris translations for better stability
const polarisTranslations = {
  Polaris: {
    Avatar: {
      label: 'Avatar',
      labelWithInitials: 'Avatar with initials {initials}',
    },
    ContextualSaveBar: {
      save: 'Save',
      discard: 'Discard',
    },
    TextField: {
      characterCount: '{count} characters',
    },
    TopBar: {
      toggleMenuLabel: 'Toggle menu',
      SearchField: {
        clearButtonLabel: 'Clear',
        search: 'Search',
      },
    },
    Button: {
      spinnerAccessibilityLabel: 'Loading',
    },
    Page: {
      rollupActionsLabel: 'View actions for {title}',
    },
    DataTable: {
      sortAccessibilityLabel: 'Sort by {direction}',
      navAccessibilityLabel: 'Pagination',
    },
    Banner: {
      dismissButton: 'Dismiss notification',
    },
    Card: {
      dismissButton: 'Dismiss',
    },
  },
};

export default function App() {
  const { apiKey, host } = useLoaderData<typeof loader>();

  return (
    <PolarisProvider i18n={polarisTranslations}>
      <Outlet />
    </PolarisProvider>
  );
}
