#!/usr/bin/env node

/**
 * Test script for Experience Center Bulk Operations
 *
 * This script tests the new bulk operations functionality by calling the
 * bulk test endpoint and verifying the results.
 */

const WORKER_URL =
	process.env.WORKER_URL || "https://woood-production.leander-4e0.workers.dev";
const SHOP = process.env.SHOP || "woood-shop.myshopify.com";

async function testBulkOperations() {
	console.log("🧪 Testing Experience Center Bulk Operations...");
	console.log(`📍 Worker URL: ${WORKER_URL}`);
	console.log(`🏪 Shop: ${SHOP}`);
	console.log("");

	try {
		// Test the bulk operations endpoint
		const response = await fetch(
			`${WORKER_URL}/api/experience-center/bulk-test`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					shop: SHOP,
				}),
			},
		);

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const result = await response.json();

		console.log("✅ Bulk Operations Test Results:");
		console.log(`   Success: ${result.success}`);
		console.log(`   Shop: ${result.shop}`);
		console.log(`   Test Type: ${result.testType}`);
		console.log(`   Timestamp: ${result.timestamp}`);
		console.log("");

		if (result.summary) {
			console.log("📊 Summary:");
			console.log(`   Available EANs: ${result.summary.availableEans}`);
			console.log(
				`   Successful Products: ${result.summary.successfulProducts}`,
			);
			console.log(`   Failed Products: ${result.summary.failedProducts}`);
			console.log(`   EAN Matches: ${result.summary.eanMatches || "N/A"}`);
			console.log(
				`   Total Products: ${result.summary.totalProducts || "N/A"}`,
			);
			console.log(`   Errors: ${result.summary.errors?.length || 0}`);
		}

		if (result.result) {
			console.log("");
			console.log("🎯 Processing Results:");
			console.log(`   Successful: ${result.result.successful}`);
			console.log(`   Failed: ${result.result.failed}`);
			console.log(`   Total Errors: ${result.result.errors?.length || 0}`);

			if (result.result.errors && result.result.errors.length > 0) {
				console.log("");
				console.log("❌ Errors:");
				result.result.errors
					.slice(0, 3)
					.forEach((/** @type {any} */ error, /** @type {number} */ index) => {
						console.log(`   ${index + 1}. ${String(error)}`);
					});
				if (result.result.errors.length > 3) {
					console.log(
						`   ... and ${result.result.errors.length - 3} more errors`,
					);
				}
			}
		}

		console.log("");
		console.log("🎉 Bulk Operations Test Completed!");

		if (result.success) {
			console.log("✅ Test PASSED - Bulk operations working correctly");
			process.exit(0);
		} else {
			console.log("❌ Test FAILED - Check errors above");
			process.exit(1);
		}
	} catch (error) {
		console.error(
			"❌ Test failed with error:",
			error instanceof Error ? error.message : String(error),
		);
		process.exit(1);
	}
}

// Run the test
testBulkOperations();
