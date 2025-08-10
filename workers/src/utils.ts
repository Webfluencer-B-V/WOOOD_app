/**
 * Essential utilities for Delivery Date Picker
 */

export function isValidShopDomain(shop: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/.test(shop);
}

export function formatDateInDutch(date: Date): string {
	try {
		return new Intl.DateTimeFormat("nl-NL", {
			weekday: "long",
			month: "short",
			day: "numeric",
		}).format(date);
	} catch {
		const weekdays = [
			"zondag",
			"maandag",
			"dinsdag",
			"woensdag",
			"donderdag",
			"vrijdag",
			"zaterdag",
		];
		const months = [
			"jan",
			"feb",
			"mrt",
			"apr",
			"mei",
			"jun",
			"jul",
			"aug",
			"sep",
			"okt",
			"nov",
			"dec",
		];
		return `${weekdays[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
	}
}

export function generateMockDates(): Array<{
	date: string;
	displayName: string;
}> {
	const dates = [];
	const today = new Date();

	for (let i = 1; i <= 14; i++) {
		const date = new Date(today);
		date.setDate(today.getDate() + i);
		dates.push({
			date: date.toISOString().split("T")[0]!,
			displayName: formatDateInDutch(date),
		});
	}

	return dates;
}
