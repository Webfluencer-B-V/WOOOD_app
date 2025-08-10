// extensions/shipping-method/node_modules/.pnpm/@shopify+shopify_function@2.0.0_@types+node@24.2.1_graphql-sock@1.0.1_graphql@16.11.0_/node_modules/@shopify/shopify_function/run.ts
function run_default(userfunction) {
	try {
		ShopifyFunction;
	} catch (e) {
		throw new Error(
			"ShopifyFunction is not defined. Please rebuild your function using the latest version of Shopify CLI.",
		);
	}
	const input_obj = ShopifyFunction.readInput();
	const output_obj = userfunction(input_obj);
	ShopifyFunction.writeOutput(output_obj);
}

// extensions/shipping-method/src/index.ts
var REFORMAT_SHIPPING_OPTION_NAMES = false;
function formatTitle(title) {
	const parts = title.split(" - ");
	const text = parts.length > 1 ? parts[1] : parts[0];
	return text
		.toLowerCase()
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}
var NO_CHANGES = {
	operations: [],
};
function run(input) {
	console.log("--- Shipping Method Function V8 (Final Cleanup) ---");
	const { lines, deliveryGroups } = input.cart;
	if (lines.length === 0 || deliveryGroups.length === 0) {
		console.log("No cart lines or delivery groups. Exiting.");
		return NO_CHANGES;
	}
	const highestPriorityLine = lines.reduce((highest, current) => {
		const currentValueStr = current.merchandise.product?.metafield?.value;
		if (!currentValueStr) return highest;
		const currentPriority = parseInt(currentValueStr, 10);
		if (isNaN(currentPriority)) return highest;
		if (!highest) return current;
		const highestValueStr = highest.merchandise.product?.metafield?.value;
		if (!highestValueStr) return current;
		const highestPriority = parseInt(highestValueStr, 10);
		if (isNaN(highestPriority)) return current;
		return currentPriority > highestPriority ? current : highest;
	}, null);
	const rawTitle = (highestPriorityLine?.merchandise).product?.metafield?.value;
	const allDeliveryOptions = deliveryGroups.flatMap(
		(group) => group.deliveryOptions,
	);
	if (allDeliveryOptions.length === 0) {
		console.error("Error: No delivery options found. Exiting.");
		return NO_CHANGES;
	}
	if (!rawTitle) {
		console.log(
			"No special shipping method required. Defaulting to 'WOOOD Standard'.",
		);
		const standardOption = allDeliveryOptions.find(
			(opt) => opt.title?.trim() === "WOOOD Standard",
		);
		if (!standardOption) {
			console.log("'WOOOD Standard' not found, making no changes.");
			return NO_CHANGES;
		}
		const operations2 = allDeliveryOptions
			.filter((opt) => opt.handle !== standardOption.handle)
			.map((opt) => ({ hide: { deliveryOptionHandle: opt.handle } }));
		return { operations: operations2 };
	}
	const titleToSet = REFORMAT_SHIPPING_OPTION_NAMES
		? formatTitle(rawTitle)
		: rawTitle;
	console.log(`Raw title: '${rawTitle}', Title to set: '${titleToSet}'`);
	const placeholderToRename = allDeliveryOptions[0];
	console.log(`Using '${placeholderToRename.title}' as placeholder to rename.`);
	const operations = [
		{
			rename: {
				deliveryOptionHandle: placeholderToRename.handle,
				title: titleToSet,
			},
		},
	];
	const otherOptions = allDeliveryOptions.slice(1);
	for (const option of otherOptions) {
		operations.push({
			hide: {
				deliveryOptionHandle: option.handle,
			},
		});
	}
	return { operations };
}

// <stdin>
function run2() {
	return run_default(run);
}
export { run2 as run };
