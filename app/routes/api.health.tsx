import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { D1Service } from '~/services/D1Service';
import { getDb } from '~/db.server';

// Get environment from context
function getEnvironment(env: any): string {
  return env.ENVIRONMENT || 'staging';
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  try {
    const env = (context as any)?.cloudflare?.env as Record<string, any> & { DB: D1Database };
    const d1Service = new D1Service(env.DB, getEnvironment(env));

    // Get all status summaries for the health check
    const [storeLocatorStatus, experienceCenterStatus] = await Promise.all([
      d1Service.getStoreLocatorStatus(),
      d1Service.getExperienceCenterStatus()
    ]);

    const statusSummary = {
      storeLocator: storeLocatorStatus,
      experienceCenter: experienceCenterStatus,
      products: {
        totalProducts: experienceCenterStatus?.productsProcessed || 0,
        experienceCenterProducts: experienceCenterStatus?.productsProcessed || 0
      }
    };

    return json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      environment: getEnvironment(env),
      services: {
        d1: 'available',
        kv: env.WOOOD_KV ? 'available' : 'unavailable',
        dutchNedApi: 'unknown',
        shopifyApi: 'available'
      },
      version: (env as any).APP_VERSION || 'dev',
      integrations: {
        storeLocator: {
          lastRun: storeLocatorStatus?.lastRun ? new Date(storeLocatorStatus.lastRun * 1000).toISOString() : new Date().toISOString(),
          status: storeLocatorStatus?.status || 'success',
          dealersProcessed: storeLocatorStatus?.dealersProcessed || 0
        },
        experienceCenter: {
          lastRun: experienceCenterStatus?.lastRun ? new Date(experienceCenterStatus.lastRun * 1000).toISOString() : new Date().toISOString(),
          status: experienceCenterStatus?.status || 'success',
          productsProcessed: experienceCenterStatus?.productsProcessed || 0
        }
      },
      data: statusSummary
    });

  } catch (error) {
    console.error('Health check error:', error);
    
    return json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      environment: 'staging',
      error: error instanceof Error ? error.message : String(error)
    }, { status: 500 });
  }
}
