#!/bin/bash
set -e

echo "🔧 Forcing npm usage and installing dependencies..."

# Remove any yarn files that might interfere
rm -f yarn.lock yarn-error.log .yarnrc .yarnrc.yml

# Force npm usage
export NPM_CONFIG_PACKAGE_MANAGER_FORCE=npm
export SKIP_DEPENDENCY_INSTALL=false

# Install dependencies with npm
npm ci

# Build the project
echo "🏗️ Building project..."
npm run build

echo "✅ Build completed successfully!"
