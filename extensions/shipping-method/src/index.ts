import {
	CartDeliveryGroup,
	CartDeliveryOption,
	type CartLine,
	type FunctionResult,
	type Input,
	Product,
} from "../generated/api";

const REFORMAT_SHIPPING_OPTION_NAMES = false;

function formatTitle(title: string): string {
	const parts = title.split(" - ");
	const text = parts.length > 1 ? parts[1] : parts[0];

	return text
		.toLowerCase()
		.split(" ")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

const NO_CHANGES: FunctionResult = {
	operations: [],
};

export function run(input: Input): FunctionResult {
	console.log("--- Shipping Method Function V8 (Final Cleanup) ---");
	const { lines, deliveryGroups } = input.cart;

	if (lines.length === 0 || deliveryGroups.length === 0) {
		console.log("No cart lines or delivery groups. Exiting.");
		return NO_CHANGES;
	}

	const highestPriorityLine = lines.reduce(
		(highest: CartLine | null, current: CartLine) => {
			const currentValueStr = (current.merchandise as any).product?.metafield
				?.value;
			if (!currentValueStr) return highest;
			const currentPriority = parseInt(currentValueStr, 10);
			if (isNaN(currentPriority)) return highest;

			if (!highest) return current;
			const highestValueStr = (highest.merchandise as any).product?.metafield
				?.value;
			if (!highestValueStr) return current;
			const highestPriority = parseInt(highestValueStr, 10);
			if (isNaN(highestPriority)) return current;

			return currentPriority > highestPriority ? current : highest;
		},
		null,
	);

	const rawTitle = (highestPriorityLine?.merchandise as any).product?.metafield
		?.value;

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

		const operations = allDeliveryOptions
			.filter((opt) => opt.handle !== standardOption.handle)
			.map((opt) => ({ hide: { deliveryOptionHandle: opt.handle } }));

		// console.log("Final operations for standard shipping:", JSON.stringify(operations, null, 2));
		return { operations };
	}

	const titleToSet = REFORMAT_SHIPPING_OPTION_NAMES
		? formatTitle(rawTitle)
		: rawTitle;
	console.log(`Raw title: '${rawTitle}', Title to set: '${titleToSet}'`);

	const placeholderToRename = allDeliveryOptions[0];
	console.log(`Using '${placeholderToRename.title}' as placeholder to rename.`);

	const operations: any[] = [
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

	// console.log("Final operations:", JSON.stringify(operations, null, 2));
	return { operations };
}
