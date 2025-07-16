# Build Commands Guide

This project has multiple build commands for different deployment scenarios:

## 🚀 Production Builds

### `yarn build` (Default)
- **Used by**: Cloudflare Workers deployment
- **Builds**: Only the Workers backend
- **Why**: Cloudflare only needs the Workers code, extensions are deployed separately to Shopify

### `yarn build:cloudflare`
- **Used by**: Cloudflare Workers deployment (explicit)
- **Builds**: Only the Workers backend
- **Same as**: `yarn build`

## 🛠️ Development Builds

### `yarn build:complete`
- **Used by**: Local development and testing
- **Builds**: Workers + Extensions (TypeScript only) + Frontend
- **Note**: Extensions built without Shopify CLI (no authentication required)

### `yarn build:full`
- **Used by**: Complete production build with Shopify CLI
- **Builds**: Workers + Extensions (with Shopify CLI) + Frontend
- **Requires**: Shopify CLI authentication

## 🎯 Specific Component Builds

### Workers
- `yarn build:workers` - Build Cloudflare Workers backend

### Frontend  
- `yarn build:frontend` - Build React admin interface

### Extensions
- `yarn build:extensions` - Build with Shopify CLI (requires auth)
- `yarn build:extensions:standalone` - Build with TypeScript only (no auth)

## 🔧 Development Commands

### `yarn dev:workers`
- Start Workers development server on localhost:8787

### `yarn dev:extensions` 
- Start Shopify extensions development (requires Shopify CLI auth)

### `yarn dev:full`
- Start both Workers and Extensions in parallel

## 📦 Deployment

### Cloudflare Workers
```bash
yarn deploy          # Deploy to production
yarn deploy:dev      # Deploy to development
```

### Shopify Extensions
```bash
yarn extensions:deploy  # Deploy extensions to Shopify
```

## 🚨 Troubleshooting

If you get Shopify CLI authentication errors during automated builds:
- Use `yarn build:cloudflare` for CI/CD pipelines
- Use `yarn build:complete` for local builds without Shopify auth
- Use `yarn build:full` only when you have Shopify CLI authenticated 