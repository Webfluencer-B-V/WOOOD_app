# WOOOD Delivery Date Management - Setup Guide

## 🚀 Production-Ready System Overview

The WOOOD Delivery Date Management system is a comprehensive solution for Shopify Plus stores that provides:

- **Delivery Date Selection** in checkout with real-time availability
- **Shipping Method Processing** with automated ERP integration
- **Order Webhook Processing** for seamless data transfer
- **OAuth Authentication** for secure Shopify integration
- **Production Monitoring** with alerts and analytics

## 📋 Prerequisites

### Required Accounts & Services

1. **Shopify Partner Account** with app development access
2. **Shopify Plus Store** (development store recommended for testing)
3. **Cloudflare Account** with Workers plan
4. **DutchNed API Access** with credentials

### Technical Requirements

- Node.js 18+ and npm/yarn
- Shopify CLI 3.0+
- Cloudflare Wrangler CLI
- Git for version control

## 🔧 Installation & Configuration

### Step 1: Clone and Setup Project

```bash
# Clone the repository
git clone [repository-url]
cd WOOOD_dutchned

# Install dependencies
npm install
```

### Step 2: Configuration Setup

**Modern Cloudflare Workers Configuration** - No `.env` files needed!

The system uses `workers/wrangler.toml` for environment variables and Cloudflare secrets for sensitive data.

1. **Verify wrangler.toml configuration:**
```toml
# workers/wrangler.toml (already configured)
[env.development]
vars = {
  ENVIRONMENT = "development",
  SHOPIFY_API_VERSION = "2025-04",
  DUTCHNED_API_URL = "https://eekhoorn-connector.dutchned.com/api/delivery-dates/available",
  SHOPIFY_APP_CLIENT_ID = "10a8926387f7ea9e09395b64b1f798c2"
}

[env.production]
vars = {
  ENVIRONMENT = "production",
  SHOPIFY_API_VERSION = "2025-04",
  DUTCHNED_API_URL = "https://eekhoorn-connector.dutchned.com/api/delivery-dates/available",
  SHOPIFY_APP_CLIENT_ID = "1c7701d2e09d4ede7616f35e13d472ef"
}
```

2. **No additional configuration files needed** - all settings are in `wrangler.toml`

### Step 3: Shopify Partner Dashboard Configuration

1. **Create new app** in Partner Dashboard:
   - App name: "WOOOD Delivery Date Management"
   - App type: "Custom app"
   - Distribution: "Private" (initially)

2. **Configure OAuth settings:**
   - App URL: `https://woood-production.leander-4e0.workers.dev`
   - Allowed redirection URLs: `https://woood-production.leander-4e0.workers.dev/auth/callback`
   - Requested scopes: `read_products,read_orders,write_order_metafields`

3. **Configure webhooks:**
   - Orders create: `https://woood-production.leander-4e0.workers.dev/api/webhooks/orders/created`
   - Orders paid: `https://woood-production.leander-4e0.workers.dev/api/webhooks/orders/paid`
   - Orders updated: `https://woood-production.leander-4e0.workers.dev/api/webhooks/orders/updated`

### Step 4: Deploy Cloudflare Workers

1. **Set up Wrangler:**
```bash
cd workers
npx wrangler auth login
```

2. **Set sensitive secrets via Cloudflare CLI:**
```bash
# Set secrets for development environment
npx wrangler secret put DUTCHNED_API_CREDENTIALS --env development
npx wrangler secret put SHOPIFY_APP_CLIENT_SECRET --env development
npx wrangler secret put SESSION_SECRET --env development
npx wrangler secret put WEBHOOK_SECRET --env development
npx wrangler secret put API_ENCRYPTION_KEY --env development

# Set secrets for production environment
npx wrangler secret put DUTCHNED_API_CREDENTIALS --env production
npx wrangler secret put SHOPIFY_APP_CLIENT_SECRET --env production
npx wrangler secret put SESSION_SECRET --env production
npx wrangler secret put WEBHOOK_SECRET --env production
npx wrangler secret put API_ENCRYPTION_KEY --env production
```

3. **Deploy Workers:**
```bash
# Deploy to development
npx wrangler deploy --env development

# Deploy to production
npx wrangler deploy --env production
```

### Step 5: Deploy Extensions

1. **Build and deploy extensions:**
```bash
# Return to project root and use modern npm scripts
yarn build:extensions
yarn extensions:deploy
```

2. **Verify extension configuration:**
```bash
yarn config:validate
```

## 🧪 Testing & Verification

### Health Check

Test all systems are operational:
```bash
curl https://woood-production.leander-4e0.workers.dev/health
```

Expected response:
```json
{
  "status": "healthy",
  "version": "1.11.1",
  "environment": "production",
  "features": {
    "oauthIntegration": true,
    "dutchNedApi": true,
    "webhookProcessing": true
  }
}
```

### API Endpoints Test

Test delivery dates:
```bash
curl https://woood-production.leander-4e0.workers.dev/api/delivery-dates/available
```

Test with product data:
```bash
curl -X POST https://woood-production.leander-4e0.workers.dev/api/products/shipping-methods \
  -H "Content-Type: application/json" \
  -d '{"productIds": ["8542690115751"], "shopDomain": "your-store.myshopify.com"}'
```

### Frontend Admin Test

1. Access admin: `https://woood-production.leander-4e0.workers.dev/?shop=your-store.myshopify.com`
2. Complete OAuth flow
3. Run system tests from dashboard
4. Verify all indicators show green

## 🏪 Store Integration

### Step 1: Install App on Development Store

1. **Generate installation URL:**
```
https://woood-production.leander-4e0.workers.dev/auth/start?shop=your-dev-store.myshopify.com
```

2. **Complete OAuth flow** and verify permissions

3. **Test extension in checkout:**
   - Add test product to cart
   - Proceed to checkout
   - Verify delivery date picker appears
   - Select date and complete order

### Step 2: Configure Test Data

Add test metafields for testing:

**ERP Delivery Time** (Product metafield):
```
Namespace: woood
Key: erp_levertijd
Value: 2025-15
```

**Shipping Method** (Product metafield):
```
Namespace: custom
Key: ShippingMethod2
Value: 31 - EXPEDITIE GESTOFFEERD
```

### Step 3: Test Complete Workflow

1. **Place test order** with delivery date selection
2. **Verify webhook processing** in Workers logs
3. **Check order metafields** created automatically
4. **Monitor admin dashboard** for metrics

## 📊 Monitoring & Maintenance

### Production Monitoring

The system includes built-in monitoring:

- **Health checks** every minute
- **Error rate tracking** with alerts
- **Performance metrics** and analytics
- **Webhook processing status**

### Alert Thresholds

- Response time > 3 seconds
- Error rate > 10%
- Uptime < 99.5%

### Log Access

View real-time logs using modern npm scripts:
```bash
# Development logs
yarn logs:dev

# Production logs
yarn logs:production
```

### KV Storage Management

Monitor storage usage:
```bash
cd workers
npx wrangler kv:key list --binding=WOOOD_KV --env production
```

## 🔒 Security Considerations

### Data Protection

- All API calls use HTTPS encryption
- OAuth tokens stored securely in Cloudflare KV
- Webhook signatures verified for authenticity
- CORS properly configured for checkout domains

### Access Control

- Admin dashboard requires Shopify OAuth
- API endpoints validate shop domains
- Webhook endpoints require valid signatures
- Environment secrets properly isolated

## 🚀 Going Live

### Pre-Launch Checklist

- [ ] All environment variables configured
- [ ] OAuth flow tested on development store
- [ ] Extension working in checkout
- [ ] Webhooks processing orders correctly
- [ ] Monitoring dashboard operational
- [ ] DutchNed API integration verified
- [ ] Error handling tested

### Launch Steps

1. **Update Partner Dashboard** to public distribution
2. **Set production CORS origins** for live stores
3. **Configure production webhooks**
4. **Enable monitoring alerts**
5. **Provide store owners with installation URL**

### Post-Launch Monitoring

Monitor these metrics daily:
- System health and uptime
- Order processing success rate
- Extension usage analytics
- API response times
- Error rates and types

## 🆘 Troubleshooting

### Common Issues

**Extension not loading:**
- Check CORS configuration
- Verify API endpoint accessibility
- Review browser console for errors

**Webhooks not processing:**
- Verify webhook URL configuration
- Check signature validation
- Review Workers logs for errors

**OAuth failures:**
- Confirm client ID/secret configuration
- Check redirect URL matches exactly
- Verify app URL accessibility

### Support Contacts

- **Technical Issues:** Review Workers logs and health dashboard
- **API Problems:** Check DutchNed API status
- **Extension Issues:** Test in Shopify development environment

## 📚 Additional Resources

- [Shopify App Development Guide](https://shopify.dev/apps)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Shopify Extensions Guide](https://shopify.dev/apps/checkout)

---

**Version:** 1.11.1
**Last Updated:** June 2025
**Status:** Production Ready ✅