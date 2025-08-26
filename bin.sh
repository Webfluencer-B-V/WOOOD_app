#!/usr/bin/env bash

set -eo pipefail
shopt -s nullglob

source .env

function addGitHook() {
	printf '%s\n' \
		"#!/usr/bin/env sh" \
		"set -eu" \
		"" \
		"npx @biomejs/biome check --staged --files-ignore-unknown=true --no-errors-on-unmatched" \
		"npx tsc --noEmit" \
		> .git/hooks/pre-commit
	chmod +x .git/hooks/pre-commit
}

function help() {
	echo "npx WOOOD [addGitHook,triggerWebhook,triggerWorkflow,update,version]"
}

function triggerWebhook() {
	topic=${1:-'app/uninstalled'}
	npx shopify app webhook trigger \
		--address=http://localhost:8080/shopify/webhooks \
		--api-version=2025-07 \
		--client-secret=${SHOPIFY_API_SECRET_KEY} \
		--delivery-method=http \
		--topic=${topic}
}

function triggerWorkflow() {
	workflow=${1:-github}
	# Optional second argument allows choosing a different event payload file
	# e.g. triggerWorkflow cloudflare cloudflare.tag
	event_name=${2:-$workflow}
	# Forward common env needed for non-interactive Shopify CLI auth and app config
	ACT_ENV_VARS=(
		"SHOPIFY_CLI_PARTNERS_TOKEN=${SHOPIFY_CLI_PARTNERS_TOKEN}"
		"SHOPIFY_API_KEY=${SHOPIFY_API_KEY}"
		"SHOPIFY_API_SECRET_KEY=${SHOPIFY_API_SECRET_KEY}"
		"SHOPIFY_APP_ENV=${SHOPIFY_APP_ENV}"
		"SHOPIFY_APP_URL=${SHOPIFY_APP_URL}"
	)

	# shellcheck disable=SC2068
	ACT_ENV_FLAGS=$(printf -- " --env %s" ${ACT_ENV_VARS[@]})

	# Run act with envs and artifact server
	act \
		--action-offline-mode \
		--container-architecture=linux/amd64 \
		--artifact-server-path .artifacts \
		--secret-file .github/act/.secrets \
		--env-file .env \
		--eventpath=.github/act/event.${event_name}.json \
		--remote-name=github \
		--workflows=.github/workflows/${workflow}.yml \
		${ACT_ENV_FLAGS}
}

function update() {
	if [[ $(git status --porcelain) ]]; then
		echo "ERROR: Please commit or stash your changes first"
		exit 1
	fi

	curl \
		--location \
		--silent https://api.github.com/repos/Webfluencer-B-V/WOOOD_app/tarball \
		| tar \
		--directory=. \
		--exclude={.dev.vars,.github/act,.gitignore,extensions,public,LICENSE.md,package-lock.json,README.md,SECURITY.md} \
		--extract \
		--strip-components=1 \
		--gzip

	npm install
	npm run typegen
}

function version() {
	echo ${npm_package_version}
}

${@:-help}