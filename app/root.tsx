import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useRouteError,
  isRouteErrorResponse,
} from '@remix-run/react';
import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import type { LinksFunction } from '@remix-run/react';
import polarisStyles from '@shopify/polaris/build/esm/styles.css?url';

export async function loader({ request, context }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const host = url.searchParams.get('host') || '';

  // Get environment variables from context
  const envObj = (context as any)?.cloudflare?.env || {};
  const apiKey = envObj.SHOPIFY_API_KEY || envObj.SHOPIFY_APP_CLIENT_ID;

  if (!apiKey) {
    // Return minimal page if not configured; avoids breaking non-embedded access
  return json({ ENV: { SHOPIFY_API_KEY: '', CLOUDFLARE_URL: url.origin.replace(/\/$/, ''), APP_VERSION: (envObj as any).APP_VERSION || 'dev' }, host });
  }

  const origin = url.origin.replace(/\/$/, '');
  const cfUrl = (process.env.CLOUDFLARE_URL || '').replace(/\/$/, '') || origin; // Prefer cross-env in dev

  return json({
    ENV: {
      SHOPIFY_API_KEY: String(apiKey),
      CLOUDFLARE_URL: cfUrl,
      APP_VERSION: (envObj as any).APP_VERSION || 'dev',
    },
    host,
  });
}

export const links: LinksFunction = () => [
  { rel: 'stylesheet', href: polarisStyles },
];

export function ErrorBoundary() {
  const error = useRouteError();

  if (isRouteErrorResponse(error)) {
    return (
      <html>
        <head>
          <title>Oops!</title>
          <Meta />
          <Links />
        </head>
        <body>
          <h1>
            {error.status} {error.statusText}
          </h1>
          <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
            <h2>Route Error Details:</h2>
            <p><strong>Status:</strong> {error.status}</p>
            <p><strong>Status Text:</strong> {error.statusText}</p>
            {error.data && (
              <div>
                <strong>Error Data:</strong>
                <pre style={{ background: '#f5f5f5', padding: '1rem', overflow: 'auto' }}>
                  {typeof error.data === 'string' ? error.data : JSON.stringify(error.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
          <Scripts />
        </body>
      </html>
    );
  }

  let errorMessage = "Unknown error";
  let errorStack = "";

  if (error instanceof Error) {
    errorMessage = error.message;
    errorStack = error.stack || "";
  } else if (typeof error === 'string') {
    errorMessage = error;
  } else {
    errorMessage = JSON.stringify(error);
  }

  console.error('Root Error Boundary caught error:', error);

  return (
    <html>
      <head>
        <title>Something went wrong</title>
        <Meta />
        <Links />
      </head>
      <body>
        <div style={{ padding: '2rem', fontFamily: 'system-ui, sans-serif' }}>
          <h1>Application Error</h1>
          <div style={{ background: '#fff3cd', border: '1px solid #ffeaa7', padding: '1rem', marginBottom: '1rem' }}>
            <h2>Error Details:</h2>
            <p><strong>Message:</strong> {errorMessage}</p>
            {errorStack && (
              <details>
                <summary><strong>Stack Trace:</strong></summary>
                <pre style={{ background: '#f8f9fa', padding: '1rem', overflow: 'auto', fontSize: '12px' }}>
                  {errorStack}
                </pre>
              </details>
            )}
          </div>
          <div style={{ background: '#d1ecf1', border: '1px solid #bee5eb', padding: '1rem' }}>
            <h3>Debugging Information:</h3>
            <p>This error occurred in the WOOOD Shopify app. Please check:</p>
            <ul>
              <li>Server logs for additional context</li>
              <li>Network requests in browser dev tools</li>
              <li>Environment variable configuration</li>
            </ul>
          </div>
        </div>
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { ENV, host } = useLoaderData<typeof loader>();

  return (
    <html>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <Meta />
        <Links />
      </head>
      <body>
        <div id="shopify-app-init" data-api-key={ENV.SHOPIFY_API_KEY} data-host={host}></div>
        <Outlet />
        <ScrollRestoration />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.ENV = ${JSON.stringify(ENV)}`,
          }}
        />
        <Scripts />
      </body>
    </html>
  );
}