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
  const category = url.searchParams.get('category');
  const experienceCenterOnly = url.searchParams.get('experience_center') === 'true';
  const availableOnly = url.searchParams.get('available_only') === 'true';
  const limit = parseInt(url.searchParams.get('limit') || '50');

  try {
    const products = await d1Service.getProducts({
      category: category || undefined,
      experienceCenterOnly,
      availableOnly,
      limit
    });

    await d1Service.logActivity({
      action: 'products_search',
      level: 'info',
      message: `Product search performed`,
      metadata: { category, experienceCenterOnly, availableOnly, limit, resultsCount: products.length }
    });

    return json({
      success: true,
      data: products,
      searchParams: { category, experienceCenterOnly, availableOnly, limit }
    });

  } catch (error) {
    console.error('Products error:', error);
    
    await d1Service.logActivity({
      action: 'products_error',
      level: 'error',
      message: `Product search failed: ${error instanceof Error ? error.message : String(error)}`,
      metadata: { category, experienceCenterOnly, availableOnly, limit }
    });

    return json({
      success: false,
      error: 'Failed to fetch products',
      searchParams: { category, experienceCenterOnly, availableOnly, limit }
    }, { status: 500 });
  }
}
