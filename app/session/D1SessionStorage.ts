import type { Session as ShopifySession } from '@shopify/shopify-api';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte } from 'drizzle-orm';
import { Session as SessionTable } from '../../drizzle/schema';
import type { DrizzleD1Database } from 'drizzle-orm/d1';

export class D1SessionStorage {
  constructor(private db: DrizzleD1Database<typeof import('../../drizzle/schema').schema>) {}

  async storeSession(session: ShopifySession) {
    await this.db
      .insert(SessionTable)
      .values({
        id: session.id,
        shop: session.shop,
        state: session.state,
        isOnline: session.isOnline,
        scope: session.scope || null,
        expires: session.expires ? Math.floor(session.expires.getTime() / 1000) : null,
        accessToken: (session as any).accessToken || '',
        userId: (session as any).userId || null,
        firstName: (session as any).firstName || null,
        lastName: (session as any).lastName || null,
        email: (session as any).email || null,
        accountOwner: Boolean((session as any).accountOwner),
        locale: (session as any).locale || null,
        collaborator: (session as any).collaborator ?? null,
        emailVerified: (session as any).emailVerified ?? null,
      })
      .onConflictDoUpdate({
        target: SessionTable.id,
        set: {
          shop: SessionTable.shop,
          state: SessionTable.state,
          isOnline: SessionTable.isOnline,
          scope: SessionTable.scope,
          expires: SessionTable.expires,
          accessToken: SessionTable.accessToken,
        },
      });
    return true;
  }

  async loadSession(id: string): Promise<ShopifySession | undefined> {
    const rows = await this.db.select().from(SessionTable).where(eq(SessionTable.id, id));
    const row = rows[0];
    if (!row) return undefined;
    // Minimal reconstruction for Admin API access
    const expires = row.expires ? new Date(row.expires * 1000) : undefined;
    const session = {
      id: row.id,
      shop: row.shop,
      state: row.state,
      isOnline: !!row.isOnline,
      scope: row.scope || undefined,
      expires,
      accessToken: row.accessToken || '',
      isActive: () => {
        if (!expires) return true;
        return expires.getTime() > Date.now();
      },
      toPropertyArray: function() {
        return Object.entries(this).filter(([key]) => key !== 'isActive' && key !== 'toPropertyArray').map(([key, value]) => ({ key, value }));
      }
    } as unknown as ShopifySession;
    return session;
  }

  async deleteSession(id: string) {
    await this.db.delete(SessionTable).where(eq(SessionTable.id, id));
    return true;
  }

  async deleteSessions(ids: string[]) {
    for (const id of ids) await this.deleteSession(id);
    return true;
  }
}


