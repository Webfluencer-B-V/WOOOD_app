import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { D1Service } from '~/services/D1Service';

// Get environment from context
function getEnvironment(env: any): string {
  return env.ENVIRONMENT || 'staging';
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as any)?.cloudflare?.env as Record<string, any> & { DB: D1Database };
  const d1Service = new D1Service(env.DB, getEnvironment(env));

  const url = new URL(request.url);
  const city = url.searchParams.get('city');
  const country = url.searchParams.get('country') || 'NL';

  try {
    const dealers = await d1Service.findDealersNearby(city || undefined, country);

    await d1Service.logActivity({
      action: 'store_locator_search',
      level: 'info',
      message: `Store locator search performed`,
      metadata: { city, country, resultsCount: dealers.length }
    });

    return json({
      success: true,
      data: dealers,
      searchParams: { city, country }
    });

  } catch (error) {
    console.error('Store locator error:', error);

    await d1Service.logActivity({
      action: 'store_locator_error',
      level: 'error',
      message: `Store locator search failed: ${error instanceof Error ? error.message : String(error)}`,
      metadata: { city, country }
    });

    return json({
      success: false,
      error: 'Failed to fetch store locations',
      searchParams: { city, country }
    }, { status: 500 });
  }
}
