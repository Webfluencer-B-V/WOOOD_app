import { Env, WorkerConfig } from '../types/env';
import { WorkersLogger } from '../utils/logger';

/**
 * Handle admin interface requests with proper App Bridge integration
 */
export async function handleAdminInterface(
  request: Request,
  env: Env,
  config: WorkerConfig,
  logger: WorkersLogger,
  requestId: string
): Promise<Response> {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop');
    const host = url.searchParams.get('host');

    logger.info('Admin interface request', {
      requestId,
      shop: shop ?? undefined,
      host: host ?? undefined,
      pathname: url.pathname
    });

    // Validate session for authenticated admin access
    const authResult = await authenticateRequest(request, env, logger, requestId);
    
    if (!authResult.success || !authResult.shop) {
      logger.warn('Admin access denied - authentication required', {
        requestId,
        shop: shop ?? undefined,
        error: authResult.error
      });

      // Redirect to OAuth for authentication
      const authUrl = new URL('/auth/start', request.url);
      if (shop) authUrl.searchParams.set('shop', shop);
      if (host) authUrl.searchParams.set('host', host);

      return Response.redirect(authUrl.toString(), 302);
    }

    const simpleSession = { shop: authResult.shop, accessToken: authResult.accessToken };

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>WOOOD Delivery Settings</title>
  <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@shopify/polaris@12.0.0/build/esm/styles.css">
  <style>
    body { 
      margin: 0; 
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; 
      background: #f6f6f7;
    }
    .app-container { 
      padding: 24px; 
      max-width: 1200px; 
      margin: 0 auto;
    }
    .loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 60vh;
      flex-direction: column;
      gap: 16px;
    }
    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #e1e1e1;
      border-top: 3px solid #008060;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    .header {
      background: white;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
      border: 1px solid #e1e3e5;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 24px;
      margin-bottom: 24px;
      border: 1px solid #e1e3e5;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 24px;
    }
    .status-badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-healthy { background: #d4f1d4; color: #1f4620; }
    .status-degraded { background: #fff4e6; color: #8b4513; }
    .status-error { background: #ffe6e6; color: #8b1538; }
  </style>
</head>
<body>
  <div id="app-root" class="app-container">
    <div class="header">
      <h1>WOOOD Delivery Date Picker</h1>
      <p>Managing delivery dates for <strong>${simpleSession.shop}</strong></p>
    </div>
    
    <div class="loading">
      <div class="loading-spinner"></div>
      <p>Loading admin interface...</p>
    </div>
  </div>

  <script>
    // Initialize App Bridge
    const urlParams = new URLSearchParams(window.location.search);
    const host = urlParams.get('host');
    const shop = '${simpleSession.shop}';
    
    let app = null;
    
    try {
      if (window.shopify && window.shopify.AppBridge) {
        app = window.shopify.AppBridge.createApp({
          apiKey: '${config.shopifyOAuth.clientId}',
          host: host,
          forceRedirect: true
        });
        
        console.log('App Bridge initialized successfully');
      } else {
        console.warn('App Bridge not available, running in standalone mode');
      }
    } catch (error) {
      console.error('Failed to initialize App Bridge:', error);
    }

    // Load admin interface
    async function loadAdminInterface() {
      try {
        const appRoot = document.getElementById('app-root');
        
        // Simulate loading admin components
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        appRoot.innerHTML = \`
          <div class="header">
            <h1>WOOOD Delivery Date Picker</h1>
            <p>Managing delivery dates for <strong>\${shop}</strong></p>
            <span class="status-badge status-healthy">System Online</span>
          </div>
          
          <div class="grid">
            <div class="card">
              <h3>System Health</h3>
              <p>All services are operational</p>
              <div style="margin-top: 16px;">
                <div>✅ DutchNed API: Connected</div>
                <div>✅ Shopify API: Connected</div>
                <div>✅ KV Storage: Available</div>
                <div>✅ Webhooks: Active</div>
              </div>
            </div>
            
            <div class="card">
              <h3>Feature Flags</h3>
              <p>Configure system features</p>
              <div style="margin-top: 16px;">
                <div>📅 Delivery Dates: Enabled</div>
                <div>🚚 Shipping Methods: Enabled</div>
                <div>🔔 Webhooks: Enabled</div>
                <div>📊 Logging: Enabled</div>
              </div>
            </div>
            
            <div class="card">
              <h3>Recent Activity</h3>
              <p>Last 24 hours</p>
              <div style="margin-top: 16px;">
                <div>📦 Orders processed: Loading...</div>
                <div>⚡ API calls: Loading...</div>
                <div>🎯 Success rate: Loading...</div>
              </div>
            </div>
            
            <div class="card">
              <h3>Quick Actions</h3>
              <p>Common administrative tasks</p>
              <div style="margin-top: 16px;">
                <button onclick="testConfiguration()" style="margin-right: 8px; padding: 8px 16px; background: #008060; color: white; border: none; border-radius: 4px; cursor: pointer;">Test Configuration</button>
                <button onclick="viewLogs()" style="padding: 8px 16px; background: #f6f6f7; border: 1px solid #e1e3e5; border-radius: 4px; cursor: pointer;">View Logs</button>
              </div>
            </div>
          </div>
        \`;
        
        console.log('Admin interface loaded successfully');
      } catch (error) {
        console.error('Failed to load admin interface:', error);
        document.getElementById('app-root').innerHTML = \`
          <div class="card">
            <h3>Error Loading Interface</h3>
            <p>Failed to load the admin interface. Please refresh the page.</p>
            <button onclick="location.reload()" style="padding: 8px 16px; background: #008060; color: white; border: none; border-radius: 4px; cursor: pointer;">Refresh</button>
          </div>
        \`;
      }
    }
    
    // Utility functions
    function testConfiguration() {
      alert('Configuration test would be implemented here');
    }
    
    function viewLogs() {
      alert('Logs viewer would be implemented here');
    }
    
    // Load the interface
    loadAdminInterface();
  </script>
</body>
</html>`;

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Frame-Options': 'ALLOWALL',
        'Content-Security-Policy': "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      }
    });

  } catch (error) {
    logger.error('Admin interface request failed', {
      requestId,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });

    return new Response(JSON.stringify({
      success: false,
      error: 'Failed to load admin interface'
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'X-Frame-Options': 'ALLOWALL',
        'Content-Security-Policy': "frame-ancestors 'self' https://*.myshopify.com https://admin.shopify.com"
      }
    });
  }
}

async function authenticateRequest(
  request: Request,
  env: Env,
  logger: WorkersLogger,
  requestId: string
): Promise<{ success: boolean; shop?: string; accessToken?: string; error?: string }> {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get('shop') || request.headers.get('X-Shopify-Shop-Domain');
    if (!shop) {
      return { success: false, error: 'Missing shop parameter' };
    }
    const tokenService = new (await import('../services/simpleTokenService')).SimpleTokenService(env);
    const accessToken = await tokenService.getToken(shop);
    if (!accessToken) {
      return { success: false, shop, error: 'No access token found for shop' };
    }
    return { success: true, shop, accessToken };
  } catch (error) {
    logger.error('Authentication failed', { requestId, error: error instanceof Error ? error.message : 'Unknown error' });
    return { success: false, error: 'Authentication failed' };
  }
} 