/**
 * Simple Token Service - Replaces complex session system with basic token storage
 * No encryption, no fingerprinting, no analytics - just simple token storage
 */

import { Env } from '../types/env';

/**
 * Simple token data structure
 */
interface ShopToken {
  accessToken: string;
  createdAt: string;
  shop: string;
}

/**
 * Simple token service for storing and retrieving Shopify access tokens
 * Replaces the overcomplicated session system with basic KV storage
 */
export class SimpleTokenService {
  constructor(private env: Env) {}

  /**
   * Store access token for a shop
   */
  async storeToken(shop: string, accessToken: string): Promise<void> {
    const tokenData: ShopToken = {
      accessToken,
      createdAt: new Date().toISOString(),
      shop
    };
    const key = `shop_token:${shop}`;
    console.log(`[SimpleTokenService] Storing token for shop:`, { shop, key });
    await this.env.DELIVERY_CACHE.put(
      key,
      JSON.stringify(tokenData),
      { expirationTtl: 86400 * 365 * 2 } // 2 years
    );
  }

  /**
   * Get access token for a shop
   */
  async getToken(shop: string): Promise<string | null> {
    const key = `shop_token:${shop}`;
    console.log(`[SimpleTokenService] Getting token for shop:`, { shop, key });
    try {
      const tokenData = await this.env.DELIVERY_CACHE.get(key);
      if (!tokenData) {
        return null;
      }

      const parsed: ShopToken = JSON.parse(tokenData);
      return parsed.accessToken || null;
    } catch (error) {
      console.error('Failed to get token for shop:', shop, error);
      return null;
    }
  }

  /**
   * Delete access token for a shop (app uninstall)
   */
  async deleteToken(shop: string): Promise<void> {
    await this.env.DELIVERY_CACHE.delete(`shop_token:${shop}`);
  }

  /**
   * Check if shop has a stored token
   */
  async hasToken(shop: string): Promise<boolean> {
    const key = `shop_token:${shop}`;
    console.log(`[SimpleTokenService] hasToken check for shop:`, { shop, key });
    const token = await this.getToken(shop);
    const hasToken = !!token;
    console.log(`[SimpleTokenService] hasToken result:`, { shop, key, token: token ? `${token.substring(0, 10)}...` : null, hasToken });
    return hasToken;
  }

  /**
   * Get token data with metadata
   */
  async getTokenData(shop: string): Promise<ShopToken | null> {
    try {
      const tokenData = await this.env.DELIVERY_CACHE.get(`shop_token:${shop}`);
      if (!tokenData) {
        return null;
      }

      return JSON.parse(tokenData) as ShopToken;
    } catch (error) {
      console.error('Failed to get token data for shop:', shop, error);
      return null;
    }
  }

  /**
   * List all shops with tokens (for admin purposes)
   */
  async listShopsWithTokens(): Promise<string[]> {
    try {
      const result = await this.env.DELIVERY_CACHE.list({ prefix: 'shop_token:' });
      return result.keys.map((key: { name: string }) => key.name.replace('shop_token:', ''));
    } catch (error) {
      console.error('Failed to list shops with tokens:', error);
      return [];
    }
  }
}