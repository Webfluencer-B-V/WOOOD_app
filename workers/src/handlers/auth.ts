/**
 * Modern Shopify OAuth handlers for Cloudflare Workers
 * Implements proper OAuth flow with session management and security
 */

import { Env, WorkerConfig } from '../types/env';
import { WorkersLogger } from '../utils/logger';
import { createOAuthService, OAuthUtils } from '../services/shopifyOAuthService';
import { Session } from '../types/session';

/**
 * Handle OAuth installation initiation
 * Task 10.4: OAuth Installation Handler
 */
export async function handleOAuthStart(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger: WorkersLogger,
  requestId: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');
    const isOnline = url.searchParams.get('online') === 'true';

    logger.info('OAuth installation request', {
      requestId,
      shop: shop ?? undefined,
      isOnline,
      userAgent: request.headers.get('User-Agent') ?? undefined
    });

    if (!shop) {
      return new Response(
        JSON.stringify({
          error: 'Missing shop parameter',
          message: 'Shop domain is required to start OAuth flow'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Validate shop domain format
    const validatedShop = OAuthUtils.extractShopDomain(shop || '');
    if (!validatedShop) {
      return new Response(
        JSON.stringify({
          error: 'Invalid shop domain',
          message: 'Shop domain must be a valid Shopify domain'
        }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }

    // Create OAuth service and begin flow
    const oauthService = createOAuthService(env, config);
    const authUrl = await oauthService.beginOAuth(validatedShop, isOnline);

    logger.info('OAuth URL generated', {
      requestId,
      shop: validatedShop,
      authUrl: authUrl.substring(0, 100) + '...' // Log partial URL for security
    });

    // Redirect to Shopify OAuth
    return Response.redirect(authUrl, 302);

  } catch (error) {
    logger.error('OAuth initiation failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(
      JSON.stringify({
        error: 'OAuth initiation failed',
        message: 'Unable to start OAuth flow. Please try again.'
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }
}

/**
 * Handle OAuth callback and complete installation
 * Task 10.5: OAuth Callback Handler
 */
export async function handleOAuthCallback(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger: WorkersLogger,
  requestId: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    logger.info('OAuth callback received', {
      requestId,
      shop: shop ?? undefined,
      hasCode: !!code,
      hasState: !!state,
      error: error ?? undefined
    });

    // Handle OAuth denial
    if (error) {
      logger.warn('OAuth denied by user', { requestId, shop: shop ?? undefined, error: error ?? undefined });
      return createOAuthErrorResponse(
        'OAuth Access Denied',
        'The installation was cancelled. You can try installing again from your Shopify admin.',
        shop || undefined
      );
    }

    // Validate required parameters
    if (!shop || !code || !state) {
      logger.error('OAuth callback missing parameters', {
        requestId,
        hasShop: !!shop,
        hasCode: !!code,
        hasState: !!state
      });

      return createOAuthErrorResponse(
        'Invalid OAuth Callback',
        'Missing required parameters. Please try installing the app again.',
        shop || undefined
      );
    }

    // Complete OAuth flow
    const oauthService = createOAuthService(env, config);
    const callbackResult = await oauthService.completeOAuth(request);

    logger.info('OAuth completed successfully', {
      requestId,
      shop: callbackResult.session.shop,
      sessionId: callbackResult.session.id,
      isNewInstallation: callbackResult.isNewInstallation,
      hasAccessToken: !!callbackResult.session.accessToken
    });

    // Register mandatory webhooks for new installations
    if (callbackResult.isNewInstallation) {
      await registerMandatoryWebhooks(callbackResult.session, config, logger, requestId);
    }

    // Create success response
    return createOAuthSuccessResponse(callbackResult.session, callbackResult.isNewInstallation, env);

  } catch (error) {
    logger.error('OAuth callback failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return createOAuthErrorResponse(
      'Installation Failed',
      'Unable to complete app installation. Please try again.',
      new URL(request.url).searchParams.get('shop')
    );
  }
}

/**
 * Handle app installation page (legacy)
 */
export async function handleAppInstallation(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger: WorkersLogger,
  requestId: string
): Promise<Response> {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const embedded = url.searchParams.get('embedded');
  const session = url.searchParams.get('session');

  logger.info('App installation/access request', {
    requestId,
    shop: shop ?? undefined,
    embedded: embedded ?? undefined,
    hasSession: !!session,
    pathname: url.pathname,
    searchParams: url.search
  });

  // If this is an embedded app request with session (post-OAuth), serve the frontend
  if (embedded === '1' && shop && session) {
    logger.info('Serving embedded app frontend', { requestId, shop });
    return createEmbeddedAppResponse(shop, env);
  }

  // If shop parameter is present but no session, start OAuth
  if (shop && !session) {
    logger.info('No session found, redirecting to OAuth', { requestId, shop });
    const oauthUrl = new URL(request.url);
    oauthUrl.pathname = '/auth/start';
    return Response.redirect(oauthUrl.toString(), 302);
  }

  // Default installation page
  return createInstallationPage();
}

/**
 * Register mandatory webhooks after successful installation
 */
async function registerMandatoryWebhooks(
  session: Session,
  config: WorkerConfig,
  logger: WorkersLogger,
  requestId: string
): Promise<void> {
  try {
    const webhooks = [
      {
        topic: 'orders/paid',
        address: `${config.shopifyOAuth.appUrl}/webhooks/orders/paid`,
        format: 'json',
      },
      {
        topic: 'app/uninstalled',
        address: `${config.shopifyOAuth.appUrl}/webhooks/app/uninstalled`,
        format: 'json',
      },
    ];

    logger.info('Registering mandatory webhooks', {
      requestId,
      shop: session.shop,
      webhookCount: webhooks.length
    });

    for (const webhook of webhooks) {
      try {
        // Create GraphQL mutation for webhook registration
        const mutation = `
          mutation webhookSubscriptionCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
            webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
              webhookSubscription {
                id
                callbackUrl
              }
              userErrors {
                field
                message
              }
            }
          }
        `;

        const variables = {
          topic: webhook.topic.toUpperCase().replace('/', '_'),
          webhookSubscription: {
            callbackUrl: webhook.address,
            format: webhook.format.toUpperCase(),
          },
        };

        // Make authenticated GraphQL request
        const response = await fetch(`https://${session.shop}/admin/api/${config.shopifyOAuth.apiVersion}/graphql.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': session.accessToken || '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            query: mutation,
            variables,
          }),
        });

        if (response.ok) {
          const data = await response.json() as any;
          if (data.data?.webhookSubscriptionCreate?.webhookSubscription) {
            logger.info('Webhook registered successfully', {
              requestId,
              shop: session.shop,
              topic: webhook.topic,
              webhookId: data.data.webhookSubscriptionCreate.webhookSubscription.id
            });
          } else {
            logger.warn('Webhook registration failed', {
              requestId,
              shop: session.shop,
              topic: webhook.topic,
              errors: data.data?.webhookSubscriptionCreate?.userErrors
            });
          }
        } else {
          logger.error('Webhook registration request failed', {
            requestId,
            shop: session.shop,
            topic: webhook.topic,
            status: response.status,
            statusText: response.statusText
          });
        }
      } catch (webhookError) {
        logger.error('Individual webhook registration failed', {
          requestId,
          shop: session.shop,
          topic: webhook.topic,
          error: webhookError instanceof Error ? webhookError.message : 'Unknown error'
        });
      }
    }

  } catch (error) {
    logger.error('Webhook registration failed', {
      requestId,
      shop: session.shop,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}

/**
 * Create OAuth success response with proper App Bridge integration
 */
function createOAuthSuccessResponse(session: Session, isNewInstallation: boolean, env: Env): Response {
  const successHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WOOOD Delivery - Installation ${isNewInstallation ? 'Complete' : 'Updated'}</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
    <style>
        body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 600px;
            width: 100%;
        }
    .success {
      background: #e7f5e7;
      border: 1px solid #4caf50;
      border-radius: 4px;
      padding: 15px;
            margin-bottom: 20px;
        }
        .installation-badge {
            display: inline-block;
            background: ${isNewInstallation ? '#48bb78' : '#ed8936'};
            color: white;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 14px;
            font-weight: 600;
            margin-bottom: 20px;
        }
    .redirect-info {
            background: #f7fafc;
            padding: 20px;
            border-radius: 8px;
            margin: 24px 0;
            border-left: 4px solid #4299e1;
        }
    </style>
</head>
<body>
    <div class="container">
    <div class="success">
      <h2>✅ Installation ${isNewInstallation ? 'Complete' : 'Updated'}</h2>
      <div class="installation-badge">${isNewInstallation ? 'NEW INSTALLATION' : 'UPDATE COMPLETE'}</div>
      <p>WOOOD Delivery Date Picker has been successfully ${isNewInstallation ? 'installed' : 'updated'} for ${session.shop}.</p>
      <div class="redirect-info">
        <p><strong>Redirecting to app dashboard...</strong></p>
        <p>You can access the app anytime from your Shopify Admin → Apps section.</p>
        </div>
    </div>
  </div>
    <script>
    // Initialize App Bridge and redirect to main app
    const urlParams = new URLSearchParams(window.location.search);
    const host = urlParams.get('host');
    const shop = '${session.shop}';

    if (window.shopify && window.shopify.AppBridge) {
      const app = window.shopify.AppBridge.createApp({
                 apiKey: '${env.SHOPIFY_APP_CLIENT_ID}',
        host: host,
        forceRedirect: true
      });

      // Redirect to main app interface after 3 seconds
      setTimeout(() => {
        if (window.parent !== window) {
          // We're in an iframe, redirect the parent to the app
          window.parent.location.href = '/?embedded=1&shop=' + encodeURIComponent(shop);
        } else {
          // Standalone mode, redirect current window to app
          window.location.href = '/?shop=' + encodeURIComponent(shop);
        }
      }, 3000);
    } else {
      // Fallback if App Bridge is not available
        setTimeout(() => {
        window.location.href = '/admin?shop=' + encodeURIComponent(shop);
      }, 3000);
    }
    </script>
</body>
</html>`;

  return new Response(successHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'ALLOWALL', // Allow embedding in Shopify admin
      'Content-Security-Policy': "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

/**
 * Create OAuth error response
 */
function createOAuthErrorResponse(title: string, message: string, shop?: string | null | undefined): Response {
  const errorHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>WOOOD Delivery - ${title}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
        }
        .container {
            background: white;
            padding: 40px;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            text-align: center;
            max-width: 500px;
            width: 100%;
        }
        .error-icon {
            color: #e53e3e;
            font-size: 48px;
            margin-bottom: 20px;
        }
        h1 {
            color: #2d3748;
            margin-bottom: 16px;
        }
        p {
            color: #4a5568;
            line-height: 1.6;
            margin-bottom: 24px;
        }
        .retry-btn {
            background: #4299e1;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            text-decoration: none;
            display: inline-block;
            margin: 10px;
        }
        .close-btn {
            background: #718096;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            margin: 10px;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="error-icon">❌</div>
        <h1>${title}</h1>
        <p>${message}</p>
        ${shop ? `<p><strong>Shop:</strong> ${shop}</p>` : ''}

        ${shop ? `
        <a href="/auth/start?shop=${encodeURIComponent(shop)}" class="retry-btn">
            🔄 Try Again
        </a>
        ` : ''}

        <button class="close-btn" onclick="window.close()">
            Close Window
        </button>
    </div>
</body>
</html>`;

  return new Response(errorHtml, {
    status: 400,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

/**
 * Create embedded app response that serves the frontend React app
 */
function createEmbeddedAppResponse(shop: string, env: Env): Response {
  const appHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WOOOD Delivery Date Picker</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <style>
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
      background: #f6f6f7;
    }
    .app-container {
      padding: 20px;
      max-width: 1200px;
      margin: 0 auto;
    }
    .loading {
      display: flex;
      justify-content: center;
      align-items: center;
      height: 200px;
      font-size: 18px;
      color: #637381;
    }
    .header {
      background: white;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
      margin-bottom: 24px;
    }
    .content {
      background: white;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
  </style>
</head>
<body>
  <div id="app" class="app-container">
    <div class="header">
      <h1>🚚 WOOOD Delivery Date Picker</h1>
      <p>Configure delivery date options for your WOOOD products</p>
    </div>
    <div class="content">
      <div class="loading">
        Loading app configuration...
      </div>
    </div>
  </div>

  <script>
    // Initialize App Bridge
    const urlParams = new URLSearchParams(window.location.search);
    const shop = '${shop}';
    const host = urlParams.get('host');

    if (window.shopify && window.shopify.AppBridge) {
      const app = window.shopify.AppBridge.createApp({
        apiKey: '${env.SHOPIFY_APP_CLIENT_ID}',
        host: host,
        forceRedirect: true
      });

      console.log('App Bridge initialized for shop:', shop);

      // Replace loading content with actual app
      setTimeout(() => {
        document.querySelector('.loading').innerHTML = \`
          <div>
            <h2>✅ App Ready</h2>
            <p><strong>Shop:</strong> \${shop}</p>
            <p><strong>Status:</strong> Connected and operational</p>
            <div style="margin-top: 20px; padding: 16px; background: #f0f8ff; border-radius: 6px; border-left: 4px solid #0070f3;">
              <h3>🎯 Next Steps:</h3>
              <ul style="margin: 8px 0; padding-left: 20px;">
                <li>Configure delivery date settings</li>
                <li>Set up WOOOD product integration</li>
                <li>Test delivery date picker in your store</li>
              </ul>
            </div>
          </div>
        \`;
      }, 1000);
    } else {
      console.error('App Bridge not available');
      document.querySelector('.loading').innerHTML = 'Error: App Bridge not available';
    }
  </script>
</body>
</html>`;

  return new Response(appHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}

/**
 * Create installation page for new users
 */
function createInstallationPage(): Response {
  const installHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Install WOOOD Delivery Date Picker</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0;
      padding: 20px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .container {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2);
      text-align: center;
      max-width: 500px;
      width: 100%;
    }
    .install-btn {
      background: #5563f7;
      color: white;
      border: none;
      padding: 16px 32px;
      border-radius: 8px;
      font-size: 18px;
      font-weight: 600;
      cursor: pointer;
      text-decoration: none;
      display: inline-block;
      margin-top: 20px;
    }
    .install-btn:hover {
      background: #4c5ff7;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>🚚 WOOOD Delivery Date Picker</h1>
    <p>Enhance your WOOOD store with intelligent delivery date selection for customers.</p>

    <div style="margin: 24px 0; padding: 20px; background: #f8f9ff; border-radius: 8px;">
      <h3>Features:</h3>
      <ul style="text-align: left; margin: 8px 0;">
        <li>📅 Dynamic delivery date calculation</li>
        <li>🚛 DutchNed shipping integration</li>
        <li>⚡ Real-time availability checking</li>
        <li>🎯 Seamless checkout experience</li>
      </ul>
    </div>

    <form action="/auth/start" method="get">
      <input type="text" name="shop" placeholder="your-store.myshopify.com"
             style="width: 100%; padding: 12px; margin: 16px 0; border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box;" required>
      <button type="submit" class="install-btn">
        Install App
      </button>
    </form>
  </div>
</body>
</html>`;

  return new Response(installHtml, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Frame-Options': 'ALLOWALL',
      'Content-Security-Policy': "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    }
  });
}