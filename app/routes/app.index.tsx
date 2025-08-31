import {
	Badge,
	Banner,
	Button,
	ButtonGroup,
	Card,
	InlineStack,
	Layout,
	List,
	Page,
	Scrollable,
	Text,
} from "@shopify/polaris";
import { useTranslation } from "react-i18next";
import { data, Form, useNavigation } from "react-router";

import { createShopify, ShopifyException } from "~/shopify.server";

// Minimal shape for the Shop query result to avoid strict coupling to generated types
type ShopInfoResponse = {
	data?: { shop?: { name?: string; myshopifyDomain?: string } };
	errors?: Array<{ message: string }>;
};

import {
	type EmailConfig,
	parseEmailRecipients,
	sendOmniaReportEmail,
} from "../../src/utils/email";
// Import our pure utility functions
import {
	type ExperienceCenterApiConfig,
	fetchExperienceCenterData,
	processExperienceCenterWithBulkOperations,
	type ShopifyAdminClient,
} from "../../src/utils/experienceCenter";
import {
	fetchOmniaFeedData,
	type OmniaFeedApiConfig,
	type PricingValidationConfig,
	processOmniaFeedWithBulkOperations,
	revertOmniaPricing,
} from "../../src/utils/omniaFeed";
import {
	type DealerApiConfig,
	fetchAndTransformDealers,
	upsertShopMetafield,
} from "../../src/utils/storeLocator";
import { cleanupWebhooks, registerWebhooks } from "../../src/utils/webhooks";
import type { OmniaPricingStatus } from "../types/app";
import type { Route } from "./+types/app.index";

export async function loader({ context, request }: Route.LoaderArgs) {
	const shopify = createShopify(context);

	const client = await shopify.admin(request);

	try {
		const { data, errors } = (await client.request(/* GraphQL */ `
			#graphql
			query ShopInfo {
				shop {
					name
					myshopifyDomain
				}
			}
    `)) as ShopInfoResponse;

		// Get status information from KV storage
		const shopDomain = data?.shop?.myshopifyDomain;
		let experienceCenterStatus = null;
		let storeLocatorStatus = null;
		let omniaPricingStatus = null;
		let isEcSchedulerEnabled: boolean | null = null;
		let isSlSchedulerEnabled: boolean | null = null;
		let isOmniaSchedulerEnabled: boolean | null = null;

		if (shopDomain) {
			try {
				experienceCenterStatus = await context.cloudflare.env.SYNC_STATUS?.get(
					`ec_last_sync:${shopDomain}`,
					"json",
				);
			} catch {
				console.warn("Failed to get experience center status");
			}

			try {
				const flag = await context.cloudflare.env.WOOOD_KV?.get(
					`scheduler:enabled:experience-center:${shopDomain}`,
				);
				isEcSchedulerEnabled = flag !== "false";
			} catch {
				isEcSchedulerEnabled = null;
			}

			try {
				storeLocatorStatus = await context.cloudflare.env.SYNC_STATUS?.get(
					`sl_last_sync:${shopDomain}`,
					"json",
				);
			} catch {
				console.warn("Failed to get store locator status");
			}

			try {
				const flag = await context.cloudflare.env.WOOOD_KV?.get(
					`scheduler:enabled:store-locator:${shopDomain}`,
				);
				isSlSchedulerEnabled = flag !== "false";
			} catch {
				isSlSchedulerEnabled = null;
			}

			try {
				omniaPricingStatus = await context.cloudflare.env.SYNC_STATUS?.get(
					`omnia_last_sync:${shopDomain}`,
					"json",
				);
			} catch {
				console.warn("Failed to get Omnia pricing status");
			}

			try {
				const flag = await context.cloudflare.env.WOOOD_KV?.get(
					`scheduler:enabled:omnia-pricing:${shopDomain}`,
				);
				isOmniaSchedulerEnabled = flag !== "false";
			} catch {
				isOmniaSchedulerEnabled = null;
			}
		}

		return {
			data,
			errors,
			experienceCenterStatus,
			storeLocatorStatus,
			omniaPricingStatus,
			isEcSchedulerEnabled,
			isSlSchedulerEnabled,
			isOmniaSchedulerEnabled,
		};
	} catch (error: unknown) {
		shopify.utils.log.error("app.index.loader.error", error);

		if (error instanceof ShopifyException) {
			switch (error.type) {
				case "GRAPHQL":
					return { errors: error.errors };

				default:
					return new Response(error.message, {
						status: error.status,
					});
			}
		}

		return data(
			{
				data: undefined,
				errors: [{ message: "Unknown Error" }],
				experienceCenterStatus: null,
				storeLocatorStatus: null,
				omniaPricingStatus: null,
			},
			500,
		);
	}
}

export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
	const data = await serverLoader();
	return data;
}

export default function AppIndex({
	actionData,
	loaderData,
}: Route.ComponentProps) {
	type StatusSummary = { timestamp?: string; success?: boolean };
	type ExperienceCenterStatus = StatusSummary & {
		summary?: {
			successful: number;
			failed: number;
			eanMatches?: number;
			totalProducts?: number;
			setTrue?: number;
			setFalse?: number;
			sourceTotal?: number;
		};
	};
	type StoreLocatorStatus = StatusSummary & { count?: number };
	type IndexLoaderData = ShopInfoResponse & {
		experienceCenterStatus?: ExperienceCenterStatus | null;
		storeLocatorStatus?: StoreLocatorStatus | null;
		omniaPricingStatus?: OmniaPricingStatus | null;
		isEcSchedulerEnabled: boolean | null;
		isSlSchedulerEnabled: boolean | null;
		isOmniaSchedulerEnabled: boolean | null;
	};

	const {
		data,
		errors,
		experienceCenterStatus,
		storeLocatorStatus,
		omniaPricingStatus,
		isEcSchedulerEnabled,
		isSlSchedulerEnabled,
		isOmniaSchedulerEnabled,
	} = (loaderData ?? {}) as IndexLoaderData;
	const navigation = useNavigation();
	const { t } = useTranslation();

	const isSubmitting = navigation.state === "submitting";
	const actionType = navigation.formData?.get("action");

	const formatTimestamp = (timestamp: string | null | undefined) => {
		if (!timestamp) return "Never";
		return new Date(timestamp).toLocaleString();
	};

	const getStatusBadge = (status: { success?: boolean } | null | undefined) => {
		if (!status) return <Badge tone="warning">No sync yet</Badge>;
		if (status.success) return <Badge tone="success">Success</Badge>;
		return <Badge tone="critical">Failed</Badge>;
	};

	return (
		<Page>
			{errors && (
				<Banner tone="critical" title="Error">
					{JSON.stringify(errors, null, 2)}
				</Banner>
			)}

			{actionData?.success === false && (
				<Banner tone="critical" title="Action Failed">
					{actionData.message}
				</Banner>
			)}

			{actionData?.success === true && (
				<Banner tone="success" title="Action Completed">
					{actionData.message}
				</Banner>
			)}

			<Layout>
				<Layout.Section>
					<Card>
						<Text variant="headingLg" as="h2">
							{data?.shop?.name}
						</Text>
						<Text as="p" tone="subdued">
							Manage Experience Center, Store Locator, and Omnia pricing
						</Text>
					</Card>
				</Layout.Section>

				<Layout.Section>
					<Card>
						<Text variant="headingMd" as="h2">
							Store Locator Sync
						</Text>
						<Text as="p" tone="subdued">
							Update store locator data from the dealers API
						</Text>

						<div style={{ marginTop: "16px" }}>
							<InlineStack gap="400" align="space-between">
								<div>
									<Text as="p">
										<strong>Status:</strong>{" "}
										{getStatusBadge(storeLocatorStatus)}
									</Text>
									<Text as="p" tone="subdued">
										Last sync: {formatTimestamp(storeLocatorStatus?.timestamp)}
									</Text>
									{storeLocatorStatus?.count && (
										<Text as="p" tone="subdued">
											Dealers: {storeLocatorStatus.count}
										</Text>
									)}
								</div>
								<ButtonGroup>
									<Form method="post">
										<input
											type="hidden"
											name="action"
											value="sync-store-locator"
										/>
										<Button
											variant="primary"
											submit
											loading={
												isSubmitting && actionType === "sync-store-locator"
											}
										>
											Update Store Locator
										</Button>
									</Form>
									<Form method="post">
										<input
											type="hidden"
											name="action"
											value="toggle-sl-scheduler"
										/>
										{isSlSchedulerEnabled !== null && (
											<Button submit>
												{isSlSchedulerEnabled ? "Disable" : "Enable"} SL
												Scheduler
											</Button>
										)}
									</Form>
								</ButtonGroup>
							</InlineStack>
						</div>
					</Card>
				</Layout.Section>

				<Layout.Section>
					<Card>
						<Text variant="headingMd" as="h2">
							Experience Center Sync
						</Text>
						<Text as="p" tone="subdued">
							Sync product availability data from the Experience Center API
						</Text>

						<div style={{ marginTop: "16px" }}>
							<InlineStack gap="400" align="space-between">
								<div>
									<Text as="p">
										<strong>Status:</strong>{" "}
										{getStatusBadge(experienceCenterStatus)}
									</Text>
									<Text as="p" tone="subdued">
										Last sync:{" "}
										{formatTimestamp(experienceCenterStatus?.timestamp)}
									</Text>
									{experienceCenterStatus?.summary && (
										<div>
											<Text as="p" tone="subdued">
												Products: {experienceCenterStatus.summary.successful}{" "}
												successful, {experienceCenterStatus.summary.failed}{" "}
												failed
											</Text>
											{typeof experienceCenterStatus.summary.sourceTotal ===
												"number" && (
												<Text as="p" tone="subdued">
													Source total:{" "}
													{experienceCenterStatus.summary.sourceTotal}
												</Text>
											)}
											{typeof experienceCenterStatus.summary.totalProducts ===
												"number" && (
												<Text as="p" tone="subdued">
													Processed products:{" "}
													{experienceCenterStatus.summary.totalProducts}
												</Text>
											)}
											{typeof experienceCenterStatus.summary.eanMatches ===
												"number" && (
												<Text as="p" tone="subdued">
													EAN matches:{" "}
													{experienceCenterStatus.summary.eanMatches}
												</Text>
											)}
											{typeof experienceCenterStatus.summary.setTrue ===
												"number" && (
												<Text as="p" tone="subdued">
													Set true: {experienceCenterStatus.summary.setTrue}
												</Text>
											)}
											{typeof experienceCenterStatus.summary.setFalse ===
												"number" && (
												<Text as="p" tone="subdued">
													Set false: {experienceCenterStatus.summary.setFalse}
												</Text>
											)}
										</div>
									)}
								</div>
								<ButtonGroup>
									<Form method="post">
										<input
											type="hidden"
											name="action"
											value="sync-experience-center"
										/>
										<Button
											variant="primary"
											submit
											loading={
												isSubmitting && actionType === "sync-experience-center"
											}
										>
											Sync Experience Center
										</Button>
									</Form>
									<Form method="post">
										<input
											type="hidden"
											name="action"
											value="toggle-ec-scheduler"
										/>
										{isEcSchedulerEnabled !== null && (
											<Button submit>
												{isEcSchedulerEnabled ? "Disable" : "Enable"} EC
												Scheduler
											</Button>
										)}
									</Form>
								</ButtonGroup>
							</InlineStack>
						</div>
					</Card>
				</Layout.Section>

				<Layout.Section>
					<Card>
						<Text variant="headingMd" as="h2">
							Omnia Pricing Sync
						</Text>
						<Text as="p" tone="subdued">
							Sync product pricing from Omnia feed with validation
						</Text>

						<div style={{ marginTop: "16px" }}>
							<InlineStack gap="400" align="space-between">
								<div>
									<Text as="p">
										<strong>Status:</strong>{" "}
										{getStatusBadge(omniaPricingStatus)}
									</Text>
									<Text as="p" tone="subdued">
										Last sync: {formatTimestamp(omniaPricingStatus?.timestamp)}
									</Text>
									{omniaPricingStatus?.summary && (
										<div>
											<Text as="p" tone="subdued">
												Products: {omniaPricingStatus.summary.successful}{" "}
												successful, {omniaPricingStatus.summary.failed} failed
											</Text>
											{typeof omniaPricingStatus.summary.sourceTotal ===
												"number" && (
												<Text as="p" tone="subdued">
													Feed total: {omniaPricingStatus.summary.sourceTotal}
												</Text>
											)}
											{typeof omniaPricingStatus.summary.totalMatches ===
												"number" && (
												<Text as="p" tone="subdued">
													Product matches:{" "}
													{omniaPricingStatus.summary.totalMatches}
												</Text>
											)}
											{typeof omniaPricingStatus.summary.validMatches ===
												"number" && (
												<Text as="p" tone="subdued">
													Valid updates:{" "}
													{omniaPricingStatus.summary.validMatches}
												</Text>
											)}
											{typeof omniaPricingStatus.summary.priceIncreases ===
												"number" && (
												<Text as="p" tone="subdued">
													Price increases:{" "}
													{omniaPricingStatus.summary.priceIncreases}
												</Text>
											)}
											{typeof omniaPricingStatus.summary.priceDecreases ===
												"number" && (
												<Text as="p" tone="subdued">
													Price decreases:{" "}
													{omniaPricingStatus.summary.priceDecreases}
												</Text>
											)}
											{typeof omniaPricingStatus.summary.feedStats
												?.totalRows === "number" && (
												<Text as="p" tone="subdued">
													Feed rows:{" "}
													{omniaPricingStatus.summary.feedStats.totalRows}{" "}
													total,{" "}
													{omniaPricingStatus.summary.feedStats.validRows} valid
												</Text>
											)}
											{Array.isArray(
												omniaPricingStatus.summary.updatedSamples,
											) &&
												omniaPricingStatus.summary.updatedSamples.length >
													0 && (
													<>
														<Text as="p" tone="subdued">
															Recent price adjustments (by product):
														</Text>
														<Scrollable
															shadow
															focusable
															style={{ maxHeight: 320 }}
														>
															<List type="bullet">
																{omniaPricingStatus.summary.updatedSamples
																	.filter((u) => u.priceChange !== 0)
																	.map((u) => {
																		const productTitle =
																			u.productTitle ||
																			`Product ${u.productId.split("/").pop()}`;
																		const shopDomain =
																			data?.shop?.myshopifyDomain;
																		return (
																			<List.Item key={u.variantId}>
																				<Text as="span" tone="subdued">
																					{u.productHandle && shopDomain ? (
																						<a
																							href={`https://${shopDomain}/admin/products/${u.productId.split("/").pop()}`}
																							target="_blank"
																							rel="noopener noreferrer"
																							style={{
																								textDecoration: "none",
																								color: "#2563eb",
																							}}
																						>
																							{productTitle}
																						</a>
																					) : (
																						productTitle
																					)}
																					{u.variantSku && ` (${u.variantSku})`}
																					: €{u.oldPrice.toFixed(2)} → €
																					{u.newPrice.toFixed(2)}
																					{u.priceChange !== 0 && (
																						<span
																							style={{
																								color:
																									u.priceChange > 0
																										? "#dc2626"
																										: "#059669",
																							}}
																						>
																							{` (${u.priceChange > 0 ? "+" : ""}€${u.priceChange.toFixed(2)})`}
																						</span>
																					)}
																				</Text>
																			</List.Item>
																		);
																	})}
															</List>
														</Scrollable>
													</>
												)}
										</div>
									)}
								</div>
								<ButtonGroup>
									<Form method="post">
										<input
											type="hidden"
											name="action"
											value="sync-omnia-pricing"
										/>
										<Button
											variant="primary"
											submit
											loading={
												isSubmitting && actionType === "sync-omnia-pricing"
											}
										>
											Sync Omnia Pricing
										</Button>
									</Form>
									<Form method="post">
										<input
											type="hidden"
											name="action"
											value="toggle-omnia-scheduler"
										/>
										{isOmniaSchedulerEnabled !== null && (
											<Button submit>
												{isOmniaSchedulerEnabled ? "Disable" : "Enable"} Omnia
												Scheduler
											</Button>
										)}
									</Form>
								</ButtonGroup>
							</InlineStack>
						</div>
					</Card>
				</Layout.Section>

				<Layout.Section>
					<Card>
						<Text variant="headingMd" as="h2">
							Webhook Management
						</Text>
						<Text as="p" tone="subdued">
							Register webhooks for order processing
						</Text>

						<div style={{ marginTop: "16px" }}>
							<Form method="post">
								<input type="hidden" name="action" value="register-webhooks" />
								<Button
									submit
									loading={isSubmitting && actionType === "register-webhooks"}
								>
									Register Webhooks
								</Button>
							</Form>
						</div>
					</Card>
				</Layout.Section>
			</Layout>
		</Page>
	);
}

export async function clientAction({ serverAction }: Route.ClientActionArgs) {
	const data = await serverAction();
	return data;
}

export async function action({ context, request }: Route.ActionArgs) {
	const shopify = createShopify(context);
	const formData = await request.formData();
	const actionType = formData.get("action");

	const client = await shopify.admin(request);

	// Get shop domain for status tracking
	const { data: shopData } = (await client.request(/* GraphQL */ `
		#graphql
		query ShopForAction {
			shop {
				myshopifyDomain
			}
		}
    `)) as ShopInfoResponse;
	const shopDomain = shopData?.shop?.myshopifyDomain;

	// Create admin client adapter for our utility functions
	const adminClientAdapter: ShopifyAdminClient = {
		request: async (query: string, variables?: Record<string, unknown>) => {
			// Shopify Remix Admin client often returns the GraphQL data directly (without { data })
			// Our utilities expect a shape { data: ... }, so only wrap when missing
			const resp = (await client.request(query, { variables })) as unknown;
			if (
				resp &&
				typeof resp === "object" &&
				"data" in (resp as Record<string, unknown>)
			) {
				return resp as unknown;
			}
			return { data: resp } as unknown;
		},
	};

	try {
		switch (actionType) {
			case "sync-experience-center": {
				const config: ExperienceCenterApiConfig = {
					baseUrl: context.cloudflare.env.DUTCH_FURNITURE_BASE_URL || "",
					apiKey: context.cloudflare.env.DUTCH_FURNITURE_API_KEY || "",
				};

				// Fetch experience center data
				const experienceCenterData = await fetchExperienceCenterData(config);
				const availableEans = new Set(
					experienceCenterData.data
						.map((item) => item.ean)
						.filter(
							(ean): ean is string => typeof ean === "string" && ean.length > 0,
						),
				);

				// Process experience center for current shop
				const result = await processExperienceCenterWithBulkOperations(
					adminClientAdapter,
					availableEans,
				);

				// Store status in KV
				if (shopDomain) {
					const status = {
						timestamp: new Date().toISOString(),
						success: true,
						summary: {
							...result,
							sourceTotal: experienceCenterData.total,
						},
						shop: shopDomain,
					};
					await context.cloudflare.env.SYNC_STATUS?.put(
						`ec_last_sync:${shopDomain}`,
						JSON.stringify(status),
					);
				}

				return {
					success: true,
					message: `Experience Center sync completed. ${result.successful} products updated successfully, ${result.failed} failed.`,
					result,
				};
			}

			case "sync-store-locator": {
				const config: DealerApiConfig = {
					baseUrl: context.cloudflare.env.DUTCH_FURNITURE_BASE_URL || "",
					apiKey: context.cloudflare.env.DUTCH_FURNITURE_API_KEY || "",
				};

				// Fetch and transform dealers
				const dealers = await fetchAndTransformDealers(config);

				// Upsert shop metafield
				const result = await upsertShopMetafield(adminClientAdapter, dealers);

				// Store status in KV
				if (shopDomain) {
					const status = {
						timestamp: new Date().toISOString(),
						success: true,
						count: dealers.length,
						shop: shopDomain,
					};
					await context.cloudflare.env.SYNC_STATUS?.put(
						`sl_last_sync:${shopDomain}`,
						JSON.stringify(status),
					);
				}

				return {
					success: true,
					message: `Store Locator sync completed. ${dealers.length} dealers updated.`,
					result,
				};
			}

			case "register-webhooks": {
				const cfUrl = (context.cloudflare.env as { CLOUDFLARE_URL?: string })
					.CLOUDFLARE_URL;
				const webhookEndpoint = `${cfUrl || context.cloudflare.env.SHOPIFY_APP_URL}/shopify/webhooks`;

				await registerWebhooks(adminClientAdapter, webhookEndpoint);
				await cleanupWebhooks(adminClientAdapter, webhookEndpoint);

				return {
					success: true,
					message: "Webhooks registered successfully.",
				};
			}

			case "toggle-ec-scheduler": {
				if (!shopDomain) throw new Error("Shop domain required");
				const key = `scheduler:enabled:experience-center:${shopDomain}`;
				const current = await context.cloudflare.env.WOOOD_KV?.get(key);
				await context.cloudflare.env.WOOOD_KV?.put(
					key,
					current === "false" ? "true" : "false",
				);
				return { success: true, message: "EC scheduler toggled" };
			}

			case "toggle-sl-scheduler": {
				if (!shopDomain) throw new Error("Shop domain required");
				const key = `scheduler:enabled:store-locator:${shopDomain}`;
				const current = await context.cloudflare.env.WOOOD_KV?.get(key);
				await context.cloudflare.env.WOOOD_KV?.put(
					key,
					current === "false" ? "true" : "false",
				);
				return { success: true, message: "Store Locator scheduler toggled" };
			}

			case "toggle-omnia-scheduler": {
				if (!shopDomain) throw new Error("Shop domain required");
				const key = `scheduler:enabled:omnia-pricing:${shopDomain}`;
				const current = await context.cloudflare.env.WOOOD_KV?.get(key);
				await context.cloudflare.env.WOOOD_KV?.put(
					key,
					current === "false" ? "true" : "false",
				);
				return { success: true, message: "Omnia scheduler toggled" };
			}

			case "sync-omnia-pricing": {
				shopify.utils.log.info("sync-omnia-pricing:start", {
					shop: shopDomain,
					feedUrl: context.cloudflare.env.OMNIA_FEED_URL ? "set" : "missing",
				});
				const config: OmniaFeedApiConfig = {
					feedUrl: context.cloudflare.env.OMNIA_FEED_URL || "",
					userAgent: "WOOOD-Shopify-Integration/1.0",
				};

				const validationConfig: PricingValidationConfig = {
					maxDiscountPercentage:
						Number(context.cloudflare.env.PRICING_MAX_DISCOUNT_PERCENTAGE) ||
						90,
					enforceBasePriceMatch:
						context.cloudflare.env.PRICING_ENFORCE_BASE_PRICE_MATCH !== "false",
					basePriceTolerance:
						Number(context.cloudflare.env.PRICING_BASE_PRICE_TOLERANCE) || 5,
					minPriceThreshold: 0.01,
					maxPriceThreshold: 10000,
				};

				// Check if this is a test run with limited products
				const limitParam = formData.get("limit");
				const testLimit = limitParam ? parseInt(limitParam.toString()) : null;

				// Fetch Omnia feed data
				const feedData = await fetchOmniaFeedData(config);

				// Keep full feed; apply any test limit post-match inside processing
				if (testLimit && testLimit > 0) {
					console.log(
						`🧪 Test mode: Processing only ${testLimit} products out of ${feedData.products.length}`,
					);
				}

				// Process pricing with bulk operations
				const result = await processOmniaFeedWithBulkOperations(
					adminClientAdapter,
					feedData.products,
					validationConfig,
					shopDomain,
					context.cloudflare.env.OMNIA_PRICING_HISTORY,
					"manual",
					testLimit ?? undefined,
				);

				shopify.utils.log.info("sync-omnia-pricing:done", {
					shop: shopDomain,
					runId: result.runId,
					successful: result.successful,
					failed: result.failed,
					totalMatches: result.totalMatches,
					validMatches: result.validMatches,
				});

				// Store status in KV
				if (shopDomain) {
					const status: OmniaPricingStatus = {
						timestamp: new Date().toISOString(),
						success: true,
						runId: result.runId,
						triggeredBy: "manual",
						summary: {
							...result,
							feedStats: {
								totalRows: feedData.totalRows,
								validRows: feedData.validRows,
								invalidRows: feedData.invalidRows,
							},
						},
						shop: shopDomain,
					};
					await context.cloudflare.env.SYNC_STATUS?.put(
						`omnia_last_sync:${shopDomain}`,
						JSON.stringify(status),
					);
				}

				return {
					success: true,
					message: `Omnia pricing sync completed. ${result.successful} products updated successfully, ${result.failed} failed. ${result.totalMatches} total matches, ${result.validMatches} valid updates.`,
					result,
				};
			}

			case "send-omnia-report-email": {
				if (!shopDomain) {
					throw new Error("Shop domain required for email sending");
				}

				// Get the latest Omnia pricing status
				const statusData =
					await context.cloudflare.env.OMNIA_PRICING_STATUS?.get(
						`omnia_last_sync:${shopDomain}`,
						"json",
					);

				if (!statusData) {
					throw new Error("No Omnia pricing sync data found to send in email");
				}

				const status = statusData as OmniaPricingStatus;

				// Configure email
				const emailConfig: EmailConfig = {
					provider: "cloudflare",
					from: context.cloudflare.env.EMAIL_FROM || "noreply@woood.dev",
					recipients: parseEmailRecipients(
						context.cloudflare.env.OMNIA_EMAIL_RECIPIENTS ||
							"leander@webfluencer.nl",
					),
					subjectPrefix:
						context.cloudflare.env.EMAIL_SUBJECT_PREFIX || "[WOOOD] ",
				};

				// Send email
				const emailResult = await sendOmniaReportEmail(status, emailConfig);

				if (!emailResult.success) {
					throw new Error(`Email send failed: ${emailResult.error}`);
				}

				return {
					success: true,
					message: `Omnia report email sent successfully to ${emailConfig.recipients.length} recipient(s)`,
				};
			}

			case "revert-omnia-pricing": {
				if (!shopDomain) {
					throw new Error("Shop domain required for price reversion");
				}

				const runIdParam = formData.get("runId");
				if (!runIdParam || typeof runIdParam !== "string") {
					throw new Error("RunId required for price reversion");
				}

				const historyKV = context.cloudflare.env.OMNIA_PRICING_HISTORY;
				if (!historyKV) {
					throw new Error("Pricing history not available");
				}

				// Revert the pricing changes
				const revertResult = await revertOmniaPricing(
					adminClientAdapter,
					shopDomain,
					runIdParam,
					historyKV,
				);

				return {
					success: true,
					message: `Successfully reverted ${revertResult.successful} price changes from runId ${runIdParam}. ${revertResult.failed} failed to revert.`,
					result: revertResult,
				};
			}

			default:
				return {
					success: false,
					message: "Unknown action",
				};
		}
	} catch (error) {
		shopify.utils.log.error("app.index.action.error", error);
		const message = error instanceof Error ? error.message : String(error);

		// Store error status in KV
		if (shopDomain) {
			let statusKey: string | null = null;
			switch (actionType) {
				case "sync-experience-center":
					statusKey = `ec_last_sync:${shopDomain}`;
					break;
				case "sync-store-locator":
					statusKey = `sl_last_sync:${shopDomain}`;
					break;
				case "sync-omnia-pricing":
					statusKey = `omnia_last_sync:${shopDomain}`;
					break;
			}
			if (statusKey) {
				const kvStore = context.cloudflare.env.SYNC_STATUS;
				const errorStatus = {
					timestamp: new Date().toISOString(),
					success: false,
					error: message,
					shop: shopDomain,
				};
				await kvStore?.put(statusKey, JSON.stringify(errorStatus));
			}
		}

		return {
			success: false,
			message: `Action failed: ${message}`,
		};
	}
}

export { headers } from "./app";
