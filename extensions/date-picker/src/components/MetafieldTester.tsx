import {
	Banner,
	BlockStack,
	Button,
	Text,
	useCartLines,
	useMetafield,
	View,
} from "@shopify/ui-extensions-react/checkout";
// React import not needed in modern JSX runtime
import {
	getExperienceCenterStatus,
	getStoreLocatorStatus,
	triggerExperienceCenterUpdate,
	triggerStoreLocatorUpdate,
} from "../services/apiClient";

/**
 * Simple test component to verify useMetafield works
 */
export function MetafieldTester() {
	const cartLines = useCartLines();

	// Test the exact metafields configured in shopify.extension.toml
	const erpMetafield = useMetafield({
		namespace: "erp",
		key: "levertijd",
	});

	const shippingMethodMetafield = useMetafield({
		namespace: "custom",
		key: "ShippingMethod2",
	});

	// Test experience center metafield
	const experienceCenterMetafield = useMetafield({
		namespace: "woood",
		key: "experiencecenter",
	});

	const handleGetExperienceCenterStatus = async () => {
		console.log("Getting experience center sync status...");

		try {
			const status = await getExperienceCenterStatus();
			if (status) {
				console.log("✅ Experience center status:", status);
			} else {
				console.log("❌ Failed to get experience center status");
			}
		} catch (error) {
			console.error("Error getting experience center status:", error);
		}
	};

	const handleTriggerStoreLocatorUpdate = async () => {
		console.log("Triggering store locator data sync...");

		try {
			const success = await triggerStoreLocatorUpdate();
			if (success) {
				console.log("✅ Store locator sync triggered successfully");
			} else {
				console.log("❌ Failed to trigger store locator sync");
			}
		} catch (error) {
			console.error("Error triggering store locator sync:", error);
		}
	};

	const handleGetStoreLocatorStatus = async () => {
		console.log("Getting store locator sync status...");

		try {
			const status = await getStoreLocatorStatus();
			if (status) {
				console.log("✅ Store locator status:", status);
			} else {
				console.log("❌ Failed to get store locator status");
			}
		} catch (error) {
			console.error("Error getting store locator status:", error);
		}
	};

	const handleTriggerScheduledUpdate = async () => {
		console.log("Triggering scheduled experience center update...");

		try {
			const success = await triggerExperienceCenterUpdate();
			if (success) {
				console.log(
					"✅ Scheduled experience center update triggered successfully",
				);
			} else {
				console.log("❌ Failed to trigger scheduled experience center update");
			}
		} catch (error) {
			console.error(
				"Error triggering scheduled experience center update:",
				error,
			);
		}
	};

	return (
		<View border="base" cornerRadius="base" padding="base">
			<BlockStack spacing="tight">
				<Text emphasis="bold">🧪 Metafield Test Results</Text>

				<Banner status="info">
					<BlockStack spacing="tight">
						<Text size="small">Cart lines: {cartLines?.length || 0}</Text>
						<Text size="small">
							ERP metafield:{" "}
							{erpMetafield ? JSON.stringify(erpMetafield) : "null"}
						</Text>
						<Text size="small">
							Shipping metafield:{" "}
							{shippingMethodMetafield
								? JSON.stringify(shippingMethodMetafield)
								: "null"}
						</Text>
						<Text size="small">
							Experience Center metafield:{" "}
							{experienceCenterMetafield
								? JSON.stringify(experienceCenterMetafield)
								: "null"}
						</Text>
					</BlockStack>
				</Banner>

				{cartLines && cartLines.length > 0 && (
					<Banner status="info">
						<BlockStack spacing="tight">
							<Text size="small" emphasis="bold">
								Cart Products:
							</Text>
							{cartLines.map((line) => {
								const product = line.merchandise?.product;
								const productId =
									product?.id?.replace("gid://shopify/Product/", "") ||
									"unknown";
								return (
									<Text key={productId} size="small">
										Product {productId} -{" "}
										{typeof (product as unknown as { title?: string })
											?.title === "string"
											? (product as unknown as { title?: string }).title
											: "Unknown"}
									</Text>
								);
							})}
						</BlockStack>
					</Banner>
				)}

				{/* Experience Center Test Section */}
				<Banner status="info">
					<BlockStack spacing="tight">
						<Text size="small" emphasis="bold">
							🏪 Experience Center Test:
						</Text>
						<Text size="small">
							Click the button below to trigger experience center data sync for
							all shops and all products.
						</Text>
						<Button onPress={handleTriggerScheduledUpdate}>
							Trigger Experience Center Sync
						</Button>
						<Button onPress={handleGetExperienceCenterStatus}>
							Get Experience Center Status
						</Button>
					</BlockStack>
				</Banner>

				{/* Store Locator Test Section */}
				<Banner status="info">
					<BlockStack spacing="tight">
						<Text size="small" emphasis="bold">
							🗺️ Store Locator Test:
						</Text>
						<Text size="small">
							Click the button below to trigger store locator data sync for all
							shops.
						</Text>
						<Button onPress={handleTriggerStoreLocatorUpdate}>
							Trigger Store Locator Sync
						</Button>
						<Button onPress={handleGetStoreLocatorStatus}>
							Get Store Locator Status
						</Button>
					</BlockStack>
				</Banner>

				{/* Scheduled Update Test Section */}
				<Banner status="info">
					<BlockStack spacing="tight">
						<Text size="small" emphasis="bold">
							⏰ Scheduled Update Test:
						</Text>
						<Text size="small">
							Click the button below to manually trigger the scheduled
							experience center update for all shops and all products (same as
							daily cron job).
						</Text>
						<Button onPress={handleTriggerScheduledUpdate}>
							Trigger Scheduled Update
						</Button>
					</BlockStack>
				</Banner>
			</BlockStack>
		</View>
	);
}
