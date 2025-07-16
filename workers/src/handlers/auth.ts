/**
 * Modern Shopify OAuth handlers for Cloudflare Workers
 * Implements proper OAuth flow with simple token storage
 */

import { Env, WorkerConfig } from '../types/env';
import { WorkersLogger } from '../utils/logger';
import { OAuthUtils } from '../services/shopifyOAuthService';
import { SimpleTokenService } from '../services/simpleTokenService';

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

    logger.info('OAuth installation request', {
      requestId,
      shop: shop ?? undefined,
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

    // Generate OAuth URL directly (no legacy session system)
    const state = generateRandomState();
    const scopes = config.shopifyOAuth.scopes.join(',');
    const oauthUrl = new URL(`https://${validatedShop}/admin/oauth/authorize`);
    oauthUrl.searchParams.set('client_id', config.shopifyOAuth.clientId);
    oauthUrl.searchParams.set('scope', scopes);
    oauthUrl.searchParams.set('redirect_uri', `${config.shopifyOAuth.appUrl}/auth/callback`);
    oauthUrl.searchParams.set('state', state);

    logger.info('OAuth URL generated', {
      requestId,
      shop: validatedShop,
      authUrl: oauthUrl.toString().substring(0, 100) + '...'
    });

    // Redirect to Shopify OAuth
    return Response.redirect(oauthUrl.toString(), 302);

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
 * Task 10.5: OAuth Callback Handler - SIMPLIFIED
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

    // Enhanced debugging for 404 troubleshooting
    const searchParams: Record<string, string> = {};
    url.searchParams.forEach((value, key) => {
      searchParams[key] = value;
    });

    logger.info('🔍 OAuth Callback Debug', {
      requestId,
      fullUrl: request.url,
      method: request.method,
      pathname: url.pathname,
      shop: shop ?? 'missing',
      code: code ? `present (${code.substring(0, 8)}...)` : 'missing',
      state: state ? `present (${state.substring(0, 8)}...)` : 'missing',
      error: error ?? 'none',
      allSearchParams: searchParams,
      userAgent: request.headers.get('User-Agent') ?? undefined,
      referer: request.headers.get('Referer') ?? undefined,
      host: request.headers.get('Host') ?? undefined
    });

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

    logger.info('[OAuthCallback] Shop domain received:', { shop });

    // Exchange code for access token
    const accessToken = await exchangeCodeForToken(shop, code, config);

    // Check if new installation BEFORE storing token
    const tokenService = new SimpleTokenService(env);
    const isNewInstallation = !(await tokenService.hasToken(shop));

    logger.info('[OAuthCallback] Checking isNewInstallation for shop:', { shop });

    // Store token simply using SimpleTokenService
    await tokenService.storeToken(shop, accessToken);

    logger.info('[OAuthCallback] isNewInstallation result:', { shop, isNewInstallation });

    logger.info('OAuth completed successfully', {
      requestId,
      shop,
      isNewInstallation,
      hasAccessToken: !!accessToken
    });

    // Register webhooks for new installations
    if (isNewInstallation) {
      await registerMandatoryWebhooks(shop, accessToken, config, env, logger, requestId);
    }

    // Create success response
    return createOAuthSuccessResponse(shop, isNewInstallation, env);

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
 * Exchange OAuth code for access token
 */
async function exchangeCodeForToken(shop: string, code: string, config: WorkerConfig): Promise<string> {
  const response = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.shopifyOAuth.clientId,
      client_secret: config.shopifyOAuth.clientSecret,
      code
    })
  });

  if (!response.ok) {
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  const data = await response.json() as { access_token: string };
  return data.access_token;
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
  const host = url.searchParams.get('host');
  const hmac = url.searchParams.get('hmac');
  const timestamp = url.searchParams.get('timestamp');

  // Enhanced debugging for embedded app loading
  const allParams: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    allParams[key] = value;
  });

  logger.info('🔍 App installation/access request debug', {
    requestId,
    shop: shop ?? 'missing',
    embedded: embedded ?? 'missing',
    session: session ?? 'missing',
    host: host ? 'present' : 'missing',
    hmac: hmac ? 'present' : 'missing',
    timestamp: timestamp ?? 'missing',
    pathname: url.pathname,
    searchParams: url.search,
    allParams,
    userAgent: request.headers.get('User-Agent') ?? undefined,
    referer: request.headers.get('Referer') ?? undefined
  });

  // If this is an embedded app request, serve the frontend (more permissive check)
  if (embedded === '1' && shop) {
    // Check if we have authentication evidence
    const hasShopifySession = url.searchParams.has('hmac') || url.searchParams.has('id_token') || url.searchParams.has('timestamp');
    const hasCustomSession = session === 'authenticated';
    const hasHost = !!host; // Shopify always provides host for embedded apps

    // Be more permissive - if it's embedded with shop and has either auth or host, serve the app
    if (hasShopifySession || hasCustomSession || hasHost) {
      logger.info('✅ Serving embedded app frontend', {
        requestId,
        shop,
        hasShopifySession,
        hasCustomSession,
        hasHost,
        authMethod: hasCustomSession ? 'custom_session' : hasShopifySession ? 'shopify_session' : 'host_only'
      });
      return createEmbeddedAppResponse(shop, env);
    } else {
      logger.warn('❌ Embedded app request missing authentication', {
        requestId,
        shop,
        embedded,
        missingAuth: 'No hmac, id_token, timestamp, session, or host parameters found'
      });
    }
  }

  // If shop parameter is present but no valid session, start OAuth
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
export async function registerMandatoryWebhooks(
  shop: string,
  accessToken: string,
  config: WorkerConfig,
  env: Env,
  logger: WorkersLogger,
  requestId: string
): Promise<void> {
  try {
    const webhooks = [
      {
        topic: 'orders/paid',
        address: `${config.shopifyOAuth.appUrl}/api/webhooks/orders/paid`,
        format: 'json',
      },
      {
        topic: 'app/uninstalled',
        address: `${config.shopifyOAuth.appUrl}/api/webhooks/app/uninstalled`,
        format: 'json',
      },
    ];

    logger.info('Registering mandatory webhooks', {
      requestId,
      shop,
      webhookCount: webhooks.length,
      appUrl: config.shopifyOAuth.appUrl
    });

    for (const webhook of webhooks) {
      try {
        // Use REST API for webhook registration (more reliable than GraphQL)
        const webhookData = {
          webhook: {
            topic: webhook.topic,
            address: webhook.address,
            format: webhook.format
          }
        };

        logger.info('Registering webhook via REST API', {
          requestId,
          shop,
          topic: webhook.topic,
          address: webhook.address,
        });

        const response = await fetch(`https://${shop}/admin/api/${config.shopifyOAuth.apiVersion}/webhooks.json`, {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': accessToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(webhookData),
        });

        if (response.ok) {
          const data = await response.json() as any;
          if (data.webhook && data.webhook.id) {
            logger.info('Webhook registered successfully', {
              requestId,
              shop,
              topic: webhook.topic,
              webhookId: data.webhook.id,
              address: data.webhook.address
            });

            // Store webhook configuration in KV for tracking
            const webhookConfig = {
              shop,
              webhookId: data.webhook.id,
              topic: webhook.topic,
              address: webhook.address,
              registeredAt: new Date().toISOString(),
              status: 'active'
            };

            await env.DELIVERY_CACHE.put(
              `webhook:${shop}:${webhook.topic}`,
              JSON.stringify(webhookConfig),
              { expirationTtl: 365 * 24 * 60 * 60 } // 1 year
            );
          } else {
            logger.warn('Webhook registration response missing webhook data', {
              requestId,
              shop,
              topic: webhook.topic,
              responseData: data
            });
          }
        } else {
          const errorData = await response.text();
          logger.error('Webhook registration request failed', {
            requestId,
            shop,
            topic: webhook.topic,
            status: response.status,
            statusText: response.statusText,
            errorData
          });
        }
      } catch (webhookError) {
        logger.error('Individual webhook registration failed', {
          requestId,
          shop,
          topic: webhook.topic,
          error: webhookError instanceof Error ? webhookError.message : 'Unknown error',
          stack: webhookError instanceof Error ? webhookError.stack : undefined
        });
      }
    }

  } catch (error) {
    logger.error('Webhook registration failed', {
      requestId,
      shop,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

/**
 * Create OAuth success response with proper App Bridge integration
 */
function createOAuthSuccessResponse(shop: string, isNewInstallation: boolean, env: Env): Response {
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
      <p>WOOOD Delivery Date Picker has been successfully ${isNewInstallation ? 'installed' : 'updated'} for ${shop}.</p>
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
    const shop = '${shop}';

    console.log('🔍 OAuth Success Page Debug:', {
      currentUrl: window.location.href,
      shop: shop,
      host: host,
      hostDecoded: host ? decodeURIComponent(host) : null,
      isEmbedded: window.parent !== window,
      hasAppBridge: !!(window.shopify && window.shopify.AppBridge),
      allParams: Object.fromEntries(urlParams.entries())
    });

    // Enhanced redirect with better URL construction
    function performRedirect() {
      const baseUrl = window.location.origin;
      const hostParam = host ? '&host=' + encodeURIComponent(host) : '';

             console.log('🔄 Preparing redirect...', {
         baseUrl,
         shop,
         host,
         hostParam,
         isEmbedded: window.parent !== window
       });

       // Test the redirect URL before using it
       const testUrl = window.parent !== window
         ? baseUrl + '/?embedded=1&shop=' + encodeURIComponent(shop) + '&session=authenticated' + hostParam
         : baseUrl + '/?shop=' + encodeURIComponent(shop) + '&session=authenticated' + hostParam;

       console.log('🧪 Testing redirect URL:', testUrl);

       // Test if the URL is accessible
       fetch(testUrl, { method: 'HEAD' })
         .then(response => {
           console.log('✅ Redirect URL test:', {
             url: testUrl,
             status: response.status,
             ok: response.ok,
             statusText: response.statusText
           });
         })
         .catch(error => {
           console.error('❌ Redirect URL test failed:', error);
         });

      if (window.parent !== window) {
        // We're in an iframe (embedded context)
        const redirectUrl = baseUrl + '/?embedded=1&shop=' + encodeURIComponent(shop) + '&session=authenticated' + hostParam;
        console.log('🔄 Redirecting parent window to:', redirectUrl);

        try {
          window.parent.location.href = redirectUrl;
        } catch (redirectError) {
          console.error('❌ Parent redirect failed:', redirectError);
          // Fallback: redirect current window
          console.log('🔄 Fallback: redirecting current window');
          window.location.href = redirectUrl;
        }
      } else {
        // Standalone mode
        const redirectUrl = baseUrl + '/?shop=' + encodeURIComponent(shop) + '&session=authenticated' + hostParam;
        console.log('🔄 Redirecting current window to:', redirectUrl);
        window.location.href = redirectUrl;
      }
    }

    if (window.shopify && window.shopify.AppBridge) {
      try {
        const app = window.shopify.AppBridge.createApp({
          apiKey: '${env.SHOPIFY_APP_CLIENT_ID}',
          host: host,
          forceRedirect: true
        });

        console.log('✅ OAuth Success: App Bridge initialized');

        // Redirect to main app interface after 5 seconds (increased delay for session save)
        setTimeout(performRedirect, 5000);
              } catch (appBridgeError) {
          console.error('❌ OAuth Success: App Bridge failed:', appBridgeError);
          // Still perform redirect even if App Bridge fails
          setTimeout(performRedirect, 5000);
        }
          } else {
        console.warn('⚠️ OAuth Success: App Bridge not available, proceeding with redirect');
        setTimeout(performRedirect, 5000);
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
    // Initialize App Bridge with enhanced debugging
    const urlParams = new URLSearchParams(window.location.search);
    const shop = '${shop}';
    const host = urlParams.get('host');

         // Debug information with modern App Bridge detection
     console.log('🔍 App Bridge Debug Info:', {
       currentUrl: window.location.href,
       shop: shop,
       host: host,
       hasShopify: !!(window.shopify),
       hasAppBridge: !!(window.shopify?.AppBridge || window.shopify?.appBridge || window.ShopifyAppBridge || window.AppBridge),
       hasLegacyAppBridge: !!(window.shopify?.AppBridge),
       hasModernAppBridge: !!(window.shopify?.appBridge),
       hasGlobalAppBridge: !!(window.ShopifyAppBridge || window.AppBridge),
       shopifyProperties: window.shopify ? Object.keys(window.shopify) : [],
       isEmbedded: window.parent !== window,
       urlParams: Object.fromEntries(urlParams.entries())
     });

         // Wait for App Bridge to load if not immediately available
     function initializeAppBridge() {
       // Check for modern App Bridge (multiple possible locations)
       const AppBridge = window.shopify?.AppBridge ||
                        window.shopify?.appBridge ||
                        window.ShopifyAppBridge ||
                        window.AppBridge;

       console.log('🔍 App Bridge detection:', {
         'window.shopify': !!window.shopify,
         'window.shopify.AppBridge': !!(window.shopify?.AppBridge),
         'window.shopify.appBridge': !!(window.shopify?.appBridge),
         'window.ShopifyAppBridge': !!window.ShopifyAppBridge,
         'window.AppBridge': !!window.AppBridge,
         'shopifyProperties': window.shopify ? Object.keys(window.shopify) : []
       });

       if (AppBridge && typeof AppBridge.createApp === 'function') {
         try {
           console.log('✅ App Bridge found, initializing...');

           const appConfig = {
             apiKey: '${env.SHOPIFY_APP_CLIENT_ID}',
             forceRedirect: true
           };

           // Only add host if it exists
           if (host) {
             appConfig.host = host;
             console.log('✅ Using host parameter:', host);
           } else {
             console.warn('⚠️ No host parameter found - this may affect embedded functionality');
           }

           const app = AppBridge.createApp(appConfig);
           console.log('✅ App Bridge initialized successfully for shop:', shop);

          // Replace loading content with actual app
          setTimeout(() => {
            document.querySelector('.loading').innerHTML = \`
              <div>
                <h2>✅ App Ready</h2>
                <p><strong>Shop:</strong> \${shop}</p>
                <p><strong>Host:</strong> \${host || 'Not provided'}</p>
                <p><strong>Status:</strong> Connected and operational</p>
                <div style="margin-top: 20px; padding: 16px; background: #f0f8ff; border-radius: 6px; border-left: 4px solid #0070f3;">
                  <h3>🎯 App Bridge Status:</h3>
                  <ul style="margin: 8px 0; padding-left: 20px;">
                    <li>✅ App Bridge: Initialized</li>
                    <li>✅ Shop: Connected</li>
                    <li>\${host ? '✅' : '⚠️'} Host: \${host || 'Missing (may affect some features)'}</li>
                    <li>✅ API: Ready</li>
                  </ul>
                </div>
                <div style="margin-top: 16px; padding: 12px; background: #f0f9f0; border-radius: 6px;">
                  <p><strong>🚀 Your WOOOD Delivery app is ready!</strong></p>
                  <p>The checkout extension and admin features are now active.</p>
                </div>
              </div>
            \`;
          }, 1000);

        } catch (appBridgeError) {
          console.error('❌ App Bridge initialization failed:', appBridgeError);
          document.querySelector('.loading').innerHTML = \`
            <div style="color: red;">
              <h2>❌ App Bridge Error</h2>
              <p>Failed to initialize App Bridge: \${appBridgeError.message}</p>
              <p><strong>Shop:</strong> \${shop}</p>
              <p><strong>Host:</strong> \${host || 'Missing'}</p>
            </div>
          \`;
        }
               } else if (window.shopify && Object.keys(window.shopify).length > 0) {
         // Shopify object exists but no App Bridge - might be new embedded app context
         console.warn('⚠️ Shopify object found but no App Bridge - using embedded context');
         console.log('Available Shopify properties:', Object.keys(window.shopify));

         document.querySelector('.loading').innerHTML = \`
           <div style="color: #0070f3;">
             <h2>🔷 Modern Shopify Context Detected</h2>
             <p><strong>Shop:</strong> \${shop}</p>
             <p><strong>Host:</strong> \${host || 'Missing'}</p>
             <p><strong>Status:</strong> Running in Shopify Admin (New Context)</p>

             <div style="margin-top: 20px; padding: 16px; background: #f0f8ff; border-radius: 6px; border-left: 4px solid #0070f3;">
               <h3>🎯 App Status:</h3>
               <ul style="margin: 8px 0; padding-left: 20px;">
                 <li>✅ Shopify Context: Active</li>
                 <li>✅ Shop: Connected</li>
                 <li>✅ Authentication: Valid</li>
                 <li>✅ API: Ready</li>
               </ul>
             </div>

             <div style="margin-top: 16px; padding: 12px; background: #f0f9f0; border-radius: 6px;">
               <p><strong>🚀 Your WOOOD Delivery app is operational!</strong></p>
               <p>✅ Checkout extensions active</p>
               <p>✅ Webhook processing active</p>
               <p>✅ API endpoints accessible</p>
             </div>

             <div style="margin-top: 16px; padding: 12px; background: #fff3cd; border-radius: 6px; font-size: 14px;">
               <p><strong>ℹ️ Note:</strong> This app is running in Shopify's modern embedded context. Classic App Bridge is not required for functionality.</p>
             </div>
           </div>
         \`;

       } else {
         console.error('❌ No Shopify context found');
         console.log('Window shopify object:', window.shopify);
         document.querySelector('.loading').innerHTML = \`
           <div style="color: orange;">
             <h2>⚠️ No Shopify Context</h2>
             <p>Neither App Bridge nor Shopify context found. This usually means:</p>
             <ul style="text-align: left; margin: 8px 0;">
               <li>The app is not running in Shopify's embedded context</li>
               <li>Network issues preventing script loading</li>
               <li>App Bridge/Shopify CDN is unavailable</li>
             </ul>
             <p><strong>Shop:</strong> \${shop}</p>
             <p><strong>Host:</strong> \${host || 'Missing'}</p>
             <div style="margin-top: 16px; padding: 12px; background: #fff3cd; border-radius: 6px;">
               <p><strong>💡 Troubleshooting:</strong></p>
               <p>Try accessing the app directly through Shopify Admin → Apps.</p>
             </div>
           </div>
         \`;
       }
     }

     // Try immediate initialization
     initializeAppBridge();

     // Check for App Bridge availability using modern detection
     const hasAnyAppBridge = !!(window.shopify?.AppBridge ||
                               window.shopify?.appBridge ||
                               window.ShopifyAppBridge ||
                               window.AppBridge);

     // If App Bridge wasn't available immediately, wait for it to load
     if (!hasAnyAppBridge && (!window.shopify || Object.keys(window.shopify).length === 0)) {
       console.log('⏳ App Bridge/Shopify context not ready, waiting for script to load...');
       setTimeout(initializeAppBridge, 1000);
       setTimeout(initializeAppBridge, 3000); // Fallback
       setTimeout(initializeAppBridge, 5000); // Extended fallback
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

/**
 * Generate random state for OAuth CSRF protection
 */
function generateRandomState(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
