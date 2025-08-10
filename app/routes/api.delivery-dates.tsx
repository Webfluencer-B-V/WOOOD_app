import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';
import { D1Service, type DeliveryDate } from '~/services/D1Service';

// Get environment from context
function getEnvironment(env: any): string {
  return env.ENVIRONMENT || 'staging';
}

// Generate mock delivery dates
function generateMockDeliveryDates(): DeliveryDate[] {
  const dates: DeliveryDate[] = [];
  const today = new Date();
  
  for (let i = 3; i <= 12; i++) {
    const deliveryDate = new Date(today);
    deliveryDate.setDate(today.getDate() + i);
    
    // Skip weekends
    if (deliveryDate.getDay() === 0 || deliveryDate.getDay() === 6) {
      continue;
    }
    
    const dateStr = deliveryDate.toISOString().split('T')[0];
    const displayName = deliveryDate.toLocaleDateString('nl-NL', {
      weekday: 'long',
      month: 'long',
      day: 'numeric'
    });
    
    dates.push({ date: dateStr, displayName });
    
    if (dates.length >= 8) break;
  }
  
  return dates;
}

export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = (context as any)?.cloudflare?.env as Record<string, any> & { DB: D1Database };
  const d1Service = new D1Service(env.DB, getEnvironment(env));
  
  const url = new URL(request.url);
  const postalCode = url.searchParams.get('postal_code');

  if (!postalCode) {
    return json({ 
      success: false, 
      error: 'Missing postal_code parameter' 
    }, { status: 400 });
  }

  try {
    // Check cache first
    const cached = await d1Service.getDeliveryDatesCache(postalCode);
    if (cached && cached.length > 0) {
      await d1Service.logActivity({
        action: 'delivery_dates_cache_hit',
        level: 'info',
        message: `Delivery dates served from cache for postal code: ${postalCode}`,
        metadata: { postalCode, datesCount: cached.length }
      });

      return json({
        success: true,
        data: cached,
        cached: true,
        postalCode
      });
    }

    // Generate fresh delivery dates
    const deliveryDates = generateMockDeliveryDates();

    // Cache the results
    await d1Service.cacheDeliveryDates(postalCode, deliveryDates, 24);

    await d1Service.logActivity({
      action: 'delivery_dates_generated',
      level: 'info',
      message: `New delivery dates generated and cached for postal code: ${postalCode}`,
      metadata: { postalCode, datesCount: deliveryDates.length }
    });

    return json({
      success: true,
      data: deliveryDates,
      cached: false,
      postalCode
    });

  } catch (error) {
    console.error('Delivery dates error:', error);
    
    await d1Service.logActivity({
      action: 'delivery_dates_error',
      level: 'error',
      message: `Delivery dates request failed: ${error instanceof Error ? error.message : String(error)}`,
      metadata: { postalCode }
    });

    return json({
      success: false,
      error: 'Failed to fetch delivery dates',
      postalCode
    }, { status: 500 });
  }
}
