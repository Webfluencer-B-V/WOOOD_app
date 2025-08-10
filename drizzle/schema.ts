import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';

// ===== SESSION MANAGEMENT (Essential for Shopify OAuth) =====
export const Session = sqliteTable('Session', {
  id: text('id').primaryKey(),
  shop: text('shop').notNull(),
  state: text('state').notNull(),
  isOnline: integer('isOnline', { mode: 'boolean' }).notNull().default(false),
  scope: text('scope'),
  expires: integer('expires'),
  accessToken: text('accessToken').notNull(),
  userId: integer('userId'),
  firstName: text('firstName'),
  lastName: text('lastName'),
  email: text('email'),
  accountOwner: integer('accountOwner', { mode: 'boolean' }).notNull().default(false),
  locale: text('locale'),
  collaborator: integer('collaborator', { mode: 'boolean' }),
  emailVerified: integer('emailVerified', { mode: 'boolean' }),
});

// ===== DELIVERY DATES CACHE (Core checkout functionality) =====
export const DeliveryDateCache = sqliteTable('DeliveryDateCache', {
  id: text('id').primaryKey(),
  postalCode: text('postalCode').notNull(),
  deliveryDatesJson: text('deliveryDatesJson').notNull(), // [{date, displayName}]
  expiresAt: integer('expiresAt').notNull(),
  lastUpdated: integer('lastUpdated').notNull(),
  environment: text('environment').notNull(),
}, (table) => ({
  postalCodeIdx: index('delivery_postal_idx').on(table.postalCode),
  expiresIdx: index('delivery_expires_idx').on(table.expiresAt),
  environmentIdx: index('delivery_environment_idx').on(table.environment),
}));

// ===== STORE LOCATOR (Dealer/Store finder functionality) =====
export const StoreLocatorStatus = sqliteTable('StoreLocatorStatus', {
  id: text('id').primaryKey(),
  lastRun: integer('lastRun').notNull(),
  status: text('status').notNull(), // 'success' | 'error' | 'running'
  dealersProcessed: integer('dealersProcessed').notNull().default(0),
  errorMessage: text('errorMessage'),
  environment: text('environment').notNull(),
}, (table) => ({
  environmentIdx: index('store_locator_environment_idx').on(table.environment),
  lastRunIdx: index('store_locator_last_run_idx').on(table.lastRun),
}));

export const DealerLocation = sqliteTable('DealerLocation', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  address: text('address').notNull(),
  city: text('city').notNull(),
  postalCode: text('postalCode').notNull(),
  country: text('country').notNull(),
  latitude: real('latitude'),
  longitude: real('longitude'),
  phone: text('phone'),
  email: text('email'),
  website: text('website'),
  servicesJson: text('servicesJson'), // JSON array of services offered
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  lastUpdated: integer('lastUpdated').notNull(),
  environment: text('environment').notNull(),
}, (table) => ({
  cityIdx: index('dealer_city_idx').on(table.city),
  countryIdx: index('dealer_country_idx').on(table.country),
  activeIdx: index('dealer_active_idx').on(table.isActive),
  environmentIdx: index('dealer_environment_idx').on(table.environment),
}));

// ===== EXPERIENCE CENTER (Product showcase functionality) =====
export const ExperienceCenterStatus = sqliteTable('ExperienceCenterStatus', {
  id: text('id').primaryKey(),
  lastRun: integer('lastRun').notNull(),
  status: text('status').notNull(), // 'success' | 'error' | 'running'
  productsProcessed: integer('productsProcessed').notNull().default(0),
  errorMessage: text('errorMessage'),
  environment: text('environment').notNull(),
}, (table) => ({
  environmentIdx: index('exp_center_environment_idx').on(table.environment),
  lastRunIdx: index('exp_center_last_run_idx').on(table.lastRun),
}));

// ===== SIMPLE PRODUCT CATALOG (Optimized for minimal compute) =====
export const ProductCatalog = sqliteTable('ProductCatalog', {
  id: text('id').primaryKey(),
  shopifyProductId: text('shopifyProductId').notNull(),
  title: text('title').notNull(),
  category: text('category'), // Simple category string
  price: real('price'), // Base price in EUR
  availability: text('availability').notNull().default('in_stock'), // 'in_stock' | 'out_of_stock' | 'discontinued'
  imageUrl: text('imageUrl'), // Single primary image URL
  isExperienceCenter: integer('isExperienceCenter', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  lastUpdated: integer('lastUpdated').notNull(),
  environment: text('environment').notNull(),
}, (table) => ({
  shopifyProductIdIdx: index('product_shopify_id_idx').on(table.shopifyProductId),
  categoryIdx: index('product_category_idx').on(table.category),
  availabilityIdx: index('product_availability_idx').on(table.availability),
  experienceCenterIdx: index('product_exp_center_idx').on(table.isExperienceCenter),
  activeIdx: index('product_active_idx').on(table.isActive),
  environmentIdx: index('product_environment_idx').on(table.environment),
}));

// ===== ACTIVITY LOGGING (Minimal debugging) =====
export const ActivityLog = sqliteTable('ActivityLog', {
  id: text('id').primaryKey(),
  action: text('action').notNull(), // 'delivery_dates_cached', 'store_locator_updated', etc.
  level: text('level').notNull(), // 'info' | 'warn' | 'error'
  message: text('message').notNull(),
  metadata: text('metadata'), // JSON string for additional context
  timestamp: integer('timestamp').notNull(),
  environment: text('environment').notNull(),
}, (table) => ({
  actionIdx: index('log_action_idx').on(table.action),
  levelIdx: index('log_level_idx').on(table.level),
  timestampIdx: index('log_timestamp_idx').on(table.timestamp),
  environmentIdx: index('log_environment_idx').on(table.environment),
}));

// ===== OFFLINE SHOP TOKENS (KV deprecation) =====
export const ShopToken = sqliteTable('ShopToken', {
  shop: text('shop').primaryKey(),
  accessToken: text('accessToken').notNull(),
  lastUpdated: integer('lastUpdated').notNull(),
  environment: text('environment').notNull(),
});

// ===== TYPE EXPORTS =====
export type SessionInsert = typeof Session.$inferInsert;
export type SessionSelect = typeof Session.$inferSelect;

export type DeliveryDateCacheInsert = typeof DeliveryDateCache.$inferInsert;
export type DeliveryDateCacheSelect = typeof DeliveryDateCache.$inferSelect;

export type StoreLocatorStatusInsert = typeof StoreLocatorStatus.$inferInsert;
export type StoreLocatorStatusSelect = typeof StoreLocatorStatus.$inferSelect;

export type DealerLocationInsert = typeof DealerLocation.$inferInsert;
export type DealerLocationSelect = typeof DealerLocation.$inferSelect;

export type ExperienceCenterStatusInsert = typeof ExperienceCenterStatus.$inferInsert;
export type ExperienceCenterStatusSelect = typeof ExperienceCenterStatus.$inferSelect;

export type ProductCatalogInsert = typeof ProductCatalog.$inferInsert;
export type ProductCatalogSelect = typeof ProductCatalog.$inferSelect;

export type ActivityLogInsert = typeof ActivityLog.$inferInsert;
export type ActivityLogSelect = typeof ActivityLog.$inferSelect;

// ===== COMBINED EXPORT =====
export const schema = {
  Session,
  DeliveryDateCache,
  StoreLocatorStatus,
  DealerLocation,
  ExperienceCenterStatus,
  ProductCatalog,
  ActivityLog,
  ShopToken,
};
