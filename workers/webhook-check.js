// Simple webhook verification script
const shop = "woood-shop.myshopify.com";

// This would normally use the stored access token from KV
// For now, we'll create a simple verification endpoint

async function checkWebhooks() {
	try {
		// Call our admin endpoint to verify system status
		const response = await fetch(
			"https://woood-production.leander-4e0.workers.dev/admin",
		);
		const html = await response.text();

		console.log("Admin interface accessible:", response.ok);
		console.log("Expected webhooks should be registered for:");
		console.log("- orders/paid → /api/webhooks/orders");
		console.log("- orders/created → /api/webhooks/orders");
		console.log("\nTo verify webhooks are working, check your Shopify admin:");
		console.log(`https://${shop}/admin/settings/notifications`);
	} catch (error) {
		console.error("Error checking webhooks:", error);
	}
}

checkWebhooks();
