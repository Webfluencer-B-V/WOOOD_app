// Minimal environment interface - extension-only essentials
interface Env {
  ENVIRONMENT: string;
  DUTCHNED_API_URL: string;
  DUTCHNED_API_CREDENTIALS: string;
  SHOPIFY_APP_CLIENT_ID: string;
  SHOPIFY_APP_CLIENT_SECRET: string;
  SHOPIFY_APP_URL: string;
  SHOPIFY_API_VERSION: string;
  ENABLE_MOCK_FALLBACK: string;
  CORS_ORIGINS: string;
  WOOOD_KV: any;
}

/**
 * Simplified OAuth handler for Shopify app installation
 * Uses simple token storage without complex session management
 */

interface OAuthTokenResponse {
  access_token: string;
  scope: string;
  expires_in?: number;
}

// OAuth start endpoint
export async function handleOAuthStart(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');

    console.log('OAuth start requested for shop:', shop);

    if (!shop) {
      console.error('OAuth start: Missing shop parameter');
      return new Response('Missing shop parameter', { status: 400 });
    }

    // Validate shop domain
    if (!isValidShopDomain(shop)) {
      console.error('OAuth start: Invalid shop domain:', shop);
      return new Response('Invalid shop domain', { status: 400 });
    }

    // Generate state for CSRF protection
    const state = crypto.randomUUID();
    console.log('OAuth start: Generated state for shop:', shop, 'state:', state);

    // Store state in KV for validation
    if (env.WOOOD_KV) {
      try {
        await env.WOOOD_KV.put(`oauth_state:${state}`, shop, { expirationTtl: 600 }); // 10 minutes
        console.log('OAuth start: State stored in KV successfully');
      } catch (error) {
        console.error('OAuth start: Failed to store state in KV:', error);
      }
    }

    // Redirect to Shopify OAuth
    const scopes = 'read_orders,write_orders,read_products';
    const redirectUri = `${env.SHOPIFY_APP_URL}/auth/callback`;

    const oauthUrl = `https://${shop}/admin/oauth/authorize?` +
      `client_id=${env.SHOPIFY_APP_CLIENT_ID}&` +
      `scope=${encodeURIComponent(scopes)}&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${state}`;

    console.log('OAuth start: Redirecting to Shopify OAuth:', {
      shop,
      clientId: env.SHOPIFY_APP_CLIENT_ID,
      redirectUri,
      scopes
    });

    return Response.redirect(oauthUrl, 302);

  } catch (error) {
    console.error('OAuth start error:', error);
    return new Response('OAuth initiation failed', { status: 500 });
  }
}

// OAuth callback endpoint
export async function handleOAuthCallback(request: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const shop = url.searchParams.get('shop');

    console.log('OAuth callback received:', { code: !!code, state: !!state, shop });

    if (!code || !state || !shop) {
      console.error('Missing OAuth parameters:', { code: !!code, state: !!state, shop });
      return new Response('Missing required parameters', { status: 400 });
    }

    // Validate state
    let storedShop = null;
    if (env.WOOOD_KV) {
      try {
        storedShop = await env.WOOOD_KV.get(`oauth_state:${state}`);
        console.log('State validation:', { storedShop, providedShop: shop });
      } catch (error) {
        console.error('KV state lookup failed:', error);
      }

      if (storedShop !== shop) {
        console.error('State validation failed:', { storedShop, providedShop: shop });
        return new Response('Invalid state parameter', { status: 400 });
      }

      // Clean up state
      try {
        await env.WOOOD_KV.delete(`oauth_state:${state}`);
        console.log('State cleaned up successfully');
      } catch (error) {
        console.warn('State cleanup failed:', error);
      }
    }

    // Exchange code for access token
    console.log('Exchanging code for token with shop:', shop);
    const tokenResponse = await fetch(`https://${shop}/admin/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        client_id: env.SHOPIFY_APP_CLIENT_ID,
        client_secret: env.SHOPIFY_APP_CLIENT_SECRET,
        code: code
      })
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', { status: tokenResponse.status, error: errorText });
      throw new Error(`Token exchange failed: ${tokenResponse.status} - ${errorText}`);
    }

    const tokenData: OAuthTokenResponse = await tokenResponse.json();
    console.log('Token exchange successful:', { scope: tokenData.scope, hasToken: !!tokenData.access_token });

    // Store token in KV
    const tokenKey = `shop_token:${shop}`;
    const tokenRecord = {
      accessToken: tokenData.access_token,
      scope: tokenData.scope,
      shop: shop,
      createdAt: Date.now(),
      expiresAt: tokenData.expires_in ? Date.now() + (tokenData.expires_in * 1000) : null
    };

    if (env.WOOOD_KV) {
      try {
        await env.WOOOD_KV.put(tokenKey, JSON.stringify(tokenRecord), {
          expirationTtl: tokenData.expires_in || 86400 // Default 24 hours
        });
        console.log('Token stored successfully for shop:', shop);
      } catch (error) {
        console.error('Token storage failed:', error);
      }
    }

    // Register webhooks
    console.log('Registering webhooks for shop:', shop);
    const webhooksRegistered = await registerWebhooks(shop, tokenData.access_token, env);
    console.log('Webhooks registered:', webhooksRegistered);

    // Redirect to Shopify admin - use the app dashboard URL
    const successUrl = `https://${shop}/admin/apps`;
    console.log('Redirecting to:', successUrl);

    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Installation Complete</title>
          <meta http-equiv="refresh" content="3;url=${successUrl}">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                   max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            .success { color: #28a745; font-size: 24px; margin-bottom: 20px; }
            .details { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .button { background: #007bff; color: white; padding: 12px 24px;
                     text-decoration: none; border-radius: 4px; display: inline-block; }
          </style>
        </head>
        <body>
          <div class="success">✅ WOOOD Delivery Date Picker Installed Successfully!</div>
          <div class="details">
            <p><strong>Shop:</strong> ${shop}</p>
            <p><strong>Webhooks Registered:</strong> ${webhooksRegistered.length}</p>
            <p><strong>Status:</strong> Ready for use</p>
            <p><em>Redirecting to Shopify admin in 3 seconds...</em></p>
          </div>
          <a href="${successUrl}" class="button">Go to Shopify Admin</a>
          <script>
            console.log('Installation complete, redirecting to:', '${successUrl}');
            // Immediate redirect for embedded context
            if (window.top !== window) {
              window.top.location.href = "${successUrl}";
            } else {
              // Auto-redirect after 3 seconds for regular context
              setTimeout(() => {
                window.location.href = "${successUrl}";
              }, 3000);
            }
          </script>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });

  } catch (error) {
    console.error('OAuth callback error:', error);
    return new Response(`
      <!DOCTYPE html>
      <html>
        <head><title>Installation Failed</title></head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                     max-width: 600px; margin: 100px auto; padding: 20px; text-align: center;">
          <h1 style="color: #dc3545;">❌ Installation Failed</h1>
          <p>Error: ${error instanceof Error ? error.message : 'Unknown error'}</p>
          <p><strong>Debug Info:</strong></p>
          <pre style="text-align: left; background: #f8f9fa; padding: 10px; border-radius: 4px;">
Shop: ${new URL(request.url).searchParams.get('shop')}
Code: ${!!new URL(request.url).searchParams.get('code')}
State: ${!!new URL(request.url).searchParams.get('state')}
          </pre>
          <p><a href="javascript:history.back()">Go Back</a></p>
        </body>
      </html>
    `, {
      status: 500,
      headers: { 'Content-Type': 'text/html' }
    });
  }
}

// App installation page
export async function handleAppInstallation(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const embedded = url.searchParams.get('embedded');
  const host = url.searchParams.get('host');

  // If this is an embedded app context, we need to break out for OAuth
  if (embedded === '1' && shop) {
    return new Response(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>WOOOD Delivery Date Picker - Install</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                   max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
            .logo { font-size: 32px; font-weight: bold; color: #2c5aa0; margin-bottom: 20px; }
            .message { font-size: 18px; color: #666; margin-bottom: 30px; line-height: 1.5; }
            .install-button { background: #28a745; color: white; padding: 15px 30px;
                             text-decoration: none; border-radius: 4px; font-size: 18px;
                             display: inline-block; margin-top: 20px; }
            .install-button:hover { background: #218838; }
          </style>
        </head>
        <body>
          <div class="logo">🚚 WOOOD Delivery Date Picker</div>
          <div class="message">
            Ready to install for <strong>${shop}</strong>
          </div>
          <button class="install-button" onclick="startInstall()">Start Installation</button>

          <script>
            function startInstall() {
              // Break out of iframe and start OAuth flow
              window.top.location.href = '/auth/start?shop=' + encodeURIComponent('${shop}');
            }

            // Auto-start installation after 2 seconds
            setTimeout(startInstall, 2000);
          </script>
        </body>
      </html>
    `, {
      headers: { 'Content-Type': 'text/html' }
    });
  }

  // Regular installation page for non-embedded context
  return new Response(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>WOOOD Delivery Date Picker</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                 max-width: 600px; margin: 100px auto; padding: 20px; text-align: center; }
          .logo { font-size: 32px; font-weight: bold; color: #2c5aa0; margin-bottom: 20px; }
          .description { font-size: 18px; color: #666; margin-bottom: 30px; line-height: 1.5; }
          .features { background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0; }
          .feature { margin: 10px 0; }
          .install-button { background: #28a745; color: white; padding: 15px 30px;
                           text-decoration: none; border-radius: 4px; font-size: 18px;
                           display: inline-block; margin-top: 20px; }
          .install-button:hover { background: #218838; }
          .shop-input { width: 300px; padding: 10px; border: 1px solid #ddd;
                       border-radius: 4px; margin: 10px; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="logo">🚚 WOOOD Delivery Date Picker</div>
        <div class="description">
          Enable customers to select delivery dates during checkout based on real DutchNed logistics availability.
        </div>

        <div class="features">
          <div class="feature">📅 Real-time delivery date selection</div>
          <div class="feature">🚚 Smart shipping method filtering</div>
          <div class="feature">⚡ Global performance via Cloudflare</div>
          <div class="feature">🔄 Automated order processing</div>
        </div>

        <form onsubmit="handleInstall(event)">
          <div>
            <input type="text"
                   class="shop-input"
                   placeholder="your-shop.myshopify.com"
                   value="${shop || ''}"
                   id="shopDomain"
                   required>
          </div>
          <button type="submit" class="install-button">Install App</button>
        </form>

        <script>
          function handleInstall(event) {
            event.preventDefault();
            const shop = document.getElementById('shopDomain').value.trim();
            if (shop) {
              const cleanShop = shop.replace(/^https?:\\/\\//, '').replace(/\\/$/, '');
              window.location.href = '/auth/start?shop=' + encodeURIComponent(cleanShop);
            }
          }
        </script>
      </body>
    </html>
  `, {
    headers: { 'Content-Type': 'text/html' }
  });
}

// Helper functions
function isValidShopDomain(shop: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

async function registerWebhooks(shop: string, accessToken: string, env: Env): Promise<string[]> {
  const webhooks = [
    {
      topic: 'orders/paid',
      address: `${env.SHOPIFY_APP_URL}/api/webhooks/orders/paid`,
      format: 'json'
    },
    {
      topic: 'app/uninstalled',
      address: `${env.SHOPIFY_APP_URL}/api/webhooks/app/uninstalled`,
      format: 'json'
    }
  ];

  const registered: string[] = [];

  for (const webhook of webhooks) {
    try {
      const response = await fetch(`https://${shop}/admin/api/2024-10/webhooks.json`, {
        method: 'POST',
        headers: {
          'X-Shopify-Access-Token': accessToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ webhook })
      });

      if (response.ok) {
        registered.push(webhook.topic);
        console.log(`Registered webhook: ${webhook.topic}`);
      } else {
        console.warn(`Failed to register webhook ${webhook.topic}:`, response.status);
      }
    } catch (error) {
      console.error(`Error registering webhook ${webhook.topic}:`, error);
    }
  }

  return registered;
}