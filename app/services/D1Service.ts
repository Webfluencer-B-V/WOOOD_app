import { drizzle } from 'drizzle-orm/d1';
import { eq, and, desc, lte, gte, like } from 'drizzle-orm';
import * as schema from '../../drizzle/schema';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

// Core interfaces
export interface DeliveryDate {
  date: string;
  displayName: string;
}

export interface DealerLocation {
  id: string;
  name: string;
  address: string;
  city: string;
  postalCode: string;
  country: string;
  latitude?: number;
  longitude?: number;
  phone?: string;
  email?: string;
  website?: string;
  services?: string[];
}

export interface SimpleProduct {
  id: string;
  shopifyProductId: string;
  title: string;
  category?: string;
  price?: number;
  availability: 'in_stock' | 'out_of_stock' | 'discontinued';
  imageUrl?: string;
  isExperienceCenter: boolean;
}

export class D1Service {
  private db: DrizzleD1Database<typeof schema>;
  private environment: string;

  constructor(d1Database: D1Database, environment = 'staging') {
    this.db = drizzle(d1Database, { schema });
    this.environment = environment;
  }

  // ===== DELIVERY DATES CACHE =====
  async cacheDeliveryDates(postalCode: string, deliveryDates: DeliveryDate[], ttlHours = 24): Promise<string> {
    const id = `delivery_${postalCode}_${Date.now()}`;
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + ttlHours * 3600;

    await this.db.insert(schema.DeliveryDateCache).values({
      id,
      postalCode: postalCode.toUpperCase(),
      deliveryDatesJson: JSON.stringify(deliveryDates),
      expiresAt,
      lastUpdated: now,
      environment: this.environment,
    });

    return id;
  }

  async getDeliveryDatesCache(postalCode: string): Promise<DeliveryDate[] | null> {
    const now = Math.floor(Date.now() / 1000);
    const rows = await this.db
      .select()
      .from(schema.DeliveryDateCache)
      .where(
        and(
          eq(schema.DeliveryDateCache.postalCode, postalCode.toUpperCase()),
          eq(schema.DeliveryDateCache.environment, this.environment),
          gte(schema.DeliveryDateCache.expiresAt, now)
        )
      )
      .orderBy(desc(schema.DeliveryDateCache.lastUpdated))
      .limit(1);

    if (rows.length === 0) return null;

    try {
      return JSON.parse(rows[0].deliveryDatesJson) as DeliveryDate[];
    } catch {
      return null;
    }
  }

  // ===== STORE LOCATOR =====
  async updateStoreLocatorStatus(status: 'success' | 'error' | 'running', dealersProcessed = 0, errorMessage?: string): Promise<void> {
    const id = `store_locator_${this.environment}`;
    const now = Math.floor(Date.now() / 1000);

    await this.db.insert(schema.StoreLocatorStatus).values({
      id,
      lastRun: now,
      status,
      dealersProcessed,
      errorMessage: errorMessage || null,
      environment: this.environment,
    }).onConflictDoUpdate({
      target: schema.StoreLocatorStatus.id,
      set: {
        lastRun: now,
        status,
        dealersProcessed,
        errorMessage: errorMessage || null,
      },
    });
  }

  async getStoreLocatorStatus(): Promise<schema.StoreLocatorStatusSelect | null> {
    const rows = await this.db
      .select()
      .from(schema.StoreLocatorStatus)
      .where(eq(schema.StoreLocatorStatus.environment, this.environment))
      .orderBy(desc(schema.StoreLocatorStatus.lastRun))
      .limit(1);

    return rows[0] || null;
  }

  async upsertDealerLocation(dealer: Omit<DealerLocation, 'id'> & { id?: string }): Promise<string> {
    const id = dealer.id || `dealer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Math.floor(Date.now() / 1000);

    await this.db.insert(schema.DealerLocation).values({
      id,
      name: dealer.name,
      address: dealer.address,
      city: dealer.city,
      postalCode: dealer.postalCode,
      country: dealer.country,
      latitude: dealer.latitude || null,
      longitude: dealer.longitude || null,
      phone: dealer.phone || null,
      email: dealer.email || null,
      website: dealer.website || null,
      servicesJson: dealer.services ? JSON.stringify(dealer.services) : null,
      isActive: true,
      lastUpdated: now,
      environment: this.environment,
    }).onConflictDoUpdate({
      target: schema.DealerLocation.id,
      set: {
        name: dealer.name,
        address: dealer.address,
        city: dealer.city,
        postalCode: dealer.postalCode,
        country: dealer.country,
        latitude: dealer.latitude || null,
        longitude: dealer.longitude || null,
        phone: dealer.phone || null,
        email: dealer.email || null,
        website: dealer.website || null,
        servicesJson: dealer.services ? JSON.stringify(dealer.services) : null,
        lastUpdated: now,
      },
    });

    return id;
  }

  async findDealersNearby(city?: string, country?: string): Promise<DealerLocation[]> {
    // Build conditions array
    const conditions = [
      eq(schema.DealerLocation.environment, this.environment),
      eq(schema.DealerLocation.isActive, true)
    ];

    if (city) {
      conditions.push(like(schema.DealerLocation.city, `%${city}%`));
    }
    if (country) {
      conditions.push(eq(schema.DealerLocation.country, country.toUpperCase()));
    }

    const rows = await this.db
      .select()
      .from(schema.DealerLocation)
      .where(and(...conditions))
      .limit(50);

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      address: row.address,
      city: row.city,
      postalCode: row.postalCode,
      country: row.country,
      latitude: row.latitude || undefined,
      longitude: row.longitude || undefined,
      phone: row.phone || undefined,
      email: row.email || undefined,
      website: row.website || undefined,
      services: row.servicesJson ? JSON.parse(row.servicesJson) : undefined,
    }));
  }

  // ===== EXPERIENCE CENTER & PRODUCTS =====
  async updateExperienceCenterStatus(status: 'success' | 'error' | 'running', productsProcessed = 0, errorMessage?: string): Promise<void> {
    const id = `exp_center_${this.environment}`;
    const now = Math.floor(Date.now() / 1000);

    await this.db.insert(schema.ExperienceCenterStatus).values({
      id,
      lastRun: now,
      status,
      productsProcessed,
      errorMessage: errorMessage || null,
      environment: this.environment,
    }).onConflictDoUpdate({
      target: schema.ExperienceCenterStatus.id,
      set: {
        lastRun: now,
        status,
        productsProcessed,
        errorMessage: errorMessage || null,
      },
    });
  }

  async getExperienceCenterStatus(): Promise<schema.ExperienceCenterStatusSelect | null> {
    const rows = await this.db
      .select()
      .from(schema.ExperienceCenterStatus)
      .where(eq(schema.ExperienceCenterStatus.environment, this.environment))
      .orderBy(desc(schema.ExperienceCenterStatus.lastRun))
      .limit(1);

    return rows[0] || null;
  }

  async upsertProduct(product: Omit<SimpleProduct, 'id'> & { id?: string }): Promise<string> {
    const id = product.id || `product_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Math.floor(Date.now() / 1000);

    await this.db.insert(schema.ProductCatalog).values({
      id,
      shopifyProductId: product.shopifyProductId,
      title: product.title,
      category: product.category || null,
      price: product.price || null,
      availability: product.availability,
      imageUrl: product.imageUrl || null,
      isExperienceCenter: product.isExperienceCenter,
      isActive: true,
      lastUpdated: now,
      environment: this.environment,
    }).onConflictDoUpdate({
      target: schema.ProductCatalog.id,
      set: {
        title: product.title,
        category: product.category || null,
        price: product.price || null,
        availability: product.availability,
        imageUrl: product.imageUrl || null,
        isExperienceCenter: product.isExperienceCenter,
        lastUpdated: now,
      },
    });

    return id;
  }

  async getProducts(options: {
    category?: string;
    experienceCenterOnly?: boolean;
    availableOnly?: boolean;
    limit?: number;
  } = {}): Promise<SimpleProduct[]> {
    const conditions = [
      eq(schema.ProductCatalog.environment, this.environment),
      eq(schema.ProductCatalog.isActive, true)
    ];

    if (options.category) {
      conditions.push(eq(schema.ProductCatalog.category, options.category));
    }
    if (options.experienceCenterOnly) {
      conditions.push(eq(schema.ProductCatalog.isExperienceCenter, true));
    }
    if (options.availableOnly) {
      conditions.push(eq(schema.ProductCatalog.availability, 'in_stock'));
    }

    const rows = await this.db
      .select()
      .from(schema.ProductCatalog)
      .where(and(...conditions))
      .limit(options.limit || 100);

    return rows.map(row => ({
      id: row.id,
      shopifyProductId: row.shopifyProductId,
      title: row.title,
      category: row.category || undefined,
      price: row.price || undefined,
      availability: row.availability as 'in_stock' | 'out_of_stock' | 'discontinued',
      imageUrl: row.imageUrl || undefined,
      isExperienceCenter: row.isExperienceCenter,
    }));
  }

  // ===== ACTIVITY LOGGING =====
  async logActivity(log: {
    action: string;
    level: 'info' | 'warn' | 'error';
    message: string;
    metadata?: Record<string, any>;
  }): Promise<string> {
    const id = `log_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    await this.db.insert(schema.ActivityLog).values({
      id,
      action: log.action,
      level: log.level,
      message: log.message,
      metadata: log.metadata ? JSON.stringify(log.metadata) : null,
      timestamp: Math.floor(Date.now() / 1000),
      environment: this.environment,
    });
    return id;
  }

  // ===== OFFLINE TOKENS (KV replacement) =====
  async upsertShopToken(shop: string, accessToken: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db.insert(schema.ShopToken).values({
      shop,
      accessToken,
      lastUpdated: now,
      environment: this.environment,
    }).onConflictDoUpdate({
      target: schema.ShopToken.shop,
      set: { accessToken, lastUpdated: now, environment: this.environment },
    });
  }

  async getShopToken(shop: string): Promise<string | null> {
    const rows = await this.db.select().from(schema.ShopToken).where(
      and(
        eq(schema.ShopToken.shop, shop),
        eq(schema.ShopToken.environment, this.environment)
      )
    ).limit(1);
    return rows[0]?.accessToken || null;
  }

  // ===== CLEANUP OPERATIONS =====
  async cleanupExpiredCache(): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    await this.db
      .delete(schema.DeliveryDateCache)
      .where(
        and(
          eq(schema.DeliveryDateCache.environment, this.environment),
          lte(schema.DeliveryDateCache.expiresAt, now)
        )
      );
  }

  async cleanupOldLogs(olderThanDays = 7): Promise<void> {
    const cutoffTime = Math.floor((Date.now() - olderThanDays * 24 * 3600 * 1000) / 1000);
    await this.db
      .delete(schema.ActivityLog)
      .where(
        and(
          eq(schema.ActivityLog.environment, this.environment),
          lte(schema.ActivityLog.timestamp, cutoffTime)
        )
      );
  }

  // ===== STATUS SUMMARY (Required by the route) =====
  async getStatusSummary(): Promise<{
    deliveryCache: { totalEntries: number };
    storeLocator: schema.StoreLocatorStatusSelect | null;
    experienceCenter: schema.ExperienceCenterStatusSelect | null;
    products: { totalProducts: number; experienceCenterProducts: number };
  }> {
    try {
      // Get cache count
      const cacheCount = await this.db
        .select({ count: schema.DeliveryDateCache.id })
        .from(schema.DeliveryDateCache)
        .where(eq(schema.DeliveryDateCache.environment, this.environment));

      // Get product counts
      const productCount = await this.db
        .select({ count: schema.ProductCatalog.id })
        .from(schema.ProductCatalog)
        .where(
          and(
            eq(schema.ProductCatalog.environment, this.environment),
            eq(schema.ProductCatalog.isActive, true)
          )
        );

      const expCenterCount = await this.db
        .select({ count: schema.ProductCatalog.id })
        .from(schema.ProductCatalog)
        .where(
          and(
            eq(schema.ProductCatalog.environment, this.environment),
            eq(schema.ProductCatalog.isActive, true),
            eq(schema.ProductCatalog.isExperienceCenter, true)
          )
        );

      return {
        deliveryCache: { totalEntries: cacheCount.length },
        storeLocator: await this.getStoreLocatorStatus(),
        experienceCenter: await this.getExperienceCenterStatus(),
        products: {
          totalProducts: productCount.length,
          experienceCenterProducts: expCenterCount.length,
        },
      };
    } catch (error) {
      console.error('Error getting status summary:', error);
      // Return safe defaults on error
      return {
        deliveryCache: { totalEntries: 0 },
        storeLocator: null,
        experienceCenter: null,
        products: {
          totalProducts: 0,
          experienceCenterProducts: 0,
        },
      };
    }
  }
}

export type D1ServiceInstance = D1Service;
