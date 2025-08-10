/**
 * Essential types for Delivery Date Picker
 */

export interface DeliveryDate {
	date: string;
	displayName: string;
}

export interface ShopToken {
	accessToken: string;
	scope: string;
	shop: string;
	createdAt: number;
}

export interface WebhookPayload {
	id: number;
	name: string;
	note_attributes?: Array<{
		name: string;
		value: string;
	}>;
}

export interface OrderMetafield {
	namespace: string;
	key: string;
	value: string;
	type: string;
}
