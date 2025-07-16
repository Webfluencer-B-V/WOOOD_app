# Installation Guide

> Complete setup guide for the WOOOD Delivery Date Picker system in 10 minutes.

## Prerequisites

Before installing, ensure you have:

- **Node.js 18+** and **npm/yarn** installed
- **Shopify Partner Account** with app development access
- **Cloudflare Account** with Workers plan
- **Git** for version control

## 🚀 Quick Installation

### Step 1: Clone and Setup Repository

```bash
# Clone the repository
git clone https://github.com/yourusername/woood-delivery-picker.git
cd woood-delivery-picker

# Install all dependencies
yarn install:all

# Validate environment
yarn env:validate
```

### Step 2: Cloudflare Workers Setup

```bash
# Navigate to workers directory
cd workers

# Login to Cloudflare (if not already logged in)
npx wrangler auth

# Create KV namespaces
npx wrangler kv:namespace create "DELIVERY_CACHE"
npx wrangler kv:namespace create "WOOOD_KV"

# Configure secrets (replace with your actual values)
npx wrangler secret put SHOPIFY_APP_CLIENT_SECRET --env development
npx wrangler secret put DUTCHNED_API_CREDENTIALS --env development
npx wrangler secret put WEBHOOK_SECRET --env development
```

### Step 3: Shopify App Setup

```bash
# Install Shopify CLI (if not already installed)
npm install -g @shopify/cli @shopify/theme

# Create Shopify app
cd ../
shopify app create

# OR use existing app configuration
# Copy your app credentials to .env files
```

### Step 4: Environment Configuration

Create environment files with your credentials:

**workers/.dev.vars**:
```bash
SHOPIFY_APP_CLIENT_SECRET=your_shopify_client_secret
DUTCHNED_API_CREDENTIALS=your_dutchned_credentials
WEBHOOK_SECRET=your_webhook_secret
```

**extensions/date-picker/.env.development**:
```bash
VITE_API_BASE_URL=https://localhost:8787
SHOPIFY_API_KEY=your_shopify_api_key
```

### Step 5: Deploy and Test

```bash
# Start local development environment
yarn dev:integrated

# In another terminal, deploy to staging
cd workers
npx wrangler deploy --env development

# Deploy Shopify extensions
cd ../extensions/date-picker
shopify app deploy
```

## 🔧 Configuration Details

### Cloudflare KV Namespaces

Update `workers/wrangler.toml` with your KV namespace IDs:

```toml
[[env.development.kv_namespaces]]
binding = "DELIVERY_CACHE"
id = "your_delivery_cache_namespace_id"
preview_id = "your_preview_namespace_id"

[[env.development.kv_namespaces]]
binding = "WOOOD_KV"
id = "your_woood_kv_namespace_id"
preview_id = "your_preview_namespace_id"
```

### Shopify App Configuration

**shopify.app.toml**:
```toml
# App identification
name = "woood-delivery-picker"
client_id = "your_shopify_client_id"

[build]
automatically_update_urls_on_dev = true
dev_store_url = "your-dev-store.myshopify.com"

[access_scopes]
scopes = "read_products,read_orders,write_order_metafields"

[webhooks]
api_version = "2025-04"

[[webhooks.subscriptions]]
topics = ["orders/paid"]
uri = "https://your-workers-domain.com/api/webhooks/orders/paid"
```

### DutchNed API Integration

Configure DutchNed API credentials:

```bash
# Get your API credentials from DutchNed
# Format: Basic base64(username:password)
DUTCHNED_API_CREDENTIALS="Basic your_base64_encoded_credentials"
```

## 🧪 Testing Installation

### 1. Test Workers API

```bash
# Test health endpoint
curl https://your-workers-domain.com/health

# Test delivery dates endpoint
curl -X POST https://your-workers-domain.com/api/delivery-dates/available \
  -H "Content-Type: application/json" \
  -H "X-Shopify-Shop-Domain: your-shop.myshopify.com" \
  -d '{"postal_code":"1234AB","country":"NL"}'
```

### 2. Test Shopify Extension

```bash
# Start Shopify development environment
shopify app dev

# Navigate to your development store
# Add products to cart and test delivery date selection
```

### 3. Test Integration

```bash
# Run integration tests
yarn test:local

# Test full workflow
yarn test:workflow:local
```

## 🔍 Troubleshooting

### Common Issues

**❌ "KV namespace not found"**
```bash
# Solution: Create KV namespaces and update wrangler.toml
npx wrangler kv:namespace create "DELIVERY_CACHE"
npx wrangler kv:namespace create "WOOOD_KV"
```

**❌ "Shopify API authentication failed"**
```bash
# Solution: Verify OAuth credentials
shopify app info
# Check .env files for correct API keys
```

**❌ "DutchNed API connection failed"**
```bash
# Solution: Test DutchNed API credentials
curl -H "Authorization: $DUTCHNED_API_CREDENTIALS" \
  https://eekhoorn-connector.dutchned.com/api/delivery-dates/available
```

**❌ "Extensions not loading"**
```bash
# Solution: Check extension configuration
cd extensions/date-picker
shopify app generate extension
shopify app dev --reset
```

### Getting Help

- **Installation Issues**: Check [Debugging Guide](../development/debugging.md)
- **API Problems**: Review [API Reference](../api/endpoints.md)
- **Configuration**: See [Environment Setup](../deployment/environment-setup.md)

## ✅ Next Steps

After successful installation:

1. **[Local Development](development.md)** - Start developing with the integrated environment
2. **[First Deployment](first-deployment.md)** - Deploy your first app to production
3. **[System Overview](../architecture/overview.md)** - Understand the system architecture

## 📞 Support

Need help with installation?

- Check [Troubleshooting Guide](../development/debugging.md)
- Review [Environment Setup](../deployment/environment-setup.md)
- See [API Reference](../api/endpoints.md) for endpoint testing

---

**⏱️ Installation Time**: ~10 minutes for experienced developers, ~20 minutes for first-time setup.