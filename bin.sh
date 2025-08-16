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
	workflow=${1:-cloudflare}
	job=${2:-build}
	echo "[triggerWorkflow] act -> .github/workflows/${workflow}.yml (job=${job})"
	ACT_SECRET_FILE=""
	ACT_VAR_FILE=""
	test -f .github/act/.secrets && ACT_SECRET_FILE="--secret-file=.github/act/.secrets"
	test -f .github/act/.vars && ACT_VAR_FILE="--var-file=.github/act/.vars"

	act \
		--action-offline-mode \
		--container-architecture=linux/amd64 \
		--eventpath=.github/act/event.${workflow}.json \
		--remote-name=github \
		--workflows=.github/workflows/${workflow}.yml \
		--job ${job} \
		--artifact-server-path=.artifacts \
		${ACT_SECRET_FILE} \
		${ACT_VAR_FILE}
}

function dryRun() {
	npm ci
	npm run build
	npx wrangler deploy -c build/server/wrangler.json --dry-run --outdir .wrangler-dryrun
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