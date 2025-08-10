import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json } from '@remix-run/cloudflare';

export async function loader({ request, context }: LoaderFunctionArgs) {
  // allow CLI with simple token to bypass session
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const env = (context as any)?.cloudflare?.env as Record<string, any>;
  if (env.STAGING_TEST_TOKEN && token !== env.STAGING_TEST_TOKEN) {
    return json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const results: any = {
    portalProductAvailability: { ok: false, status: 0, error: null },
    portalStoreLocator: { ok: false, status: 0, error: null }
  };

  try {
    const base = env.PRODUCT_AVAILABILITY_BASE_URL || 'https://portal.dutchfurniturefulfilment.nl';
    const auth = env.PRODUCT_AVAILABILITY_API_KEY;
    const res = await fetch(`${base}/api/productAvailability/query?fields=ean&fields=channel&fields=itemcode`, {
      headers: { Authorization: auth, 'Content-Type': 'application/json' }
    });
    results.portalProductAvailability.ok = res.ok;
    results.portalProductAvailability.status = res.status;
    if (!res.ok) results.portalProductAvailability.error = await res.text().catch(() => null);
  } catch (e: any) {
    results.portalProductAvailability.error = e?.message || String(e);
  }

  try {
    const base = env.DUTCH_FURNITURE_BASE_URL || 'https://portal.dutchfurniturefulfilment.nl';
    const auth = env.DUTCH_FURNITURE_API_KEY;
    const res = await fetch(`${base}/api/datasource/wooodshopfinder`, {
      headers: { Authorization: auth, 'Content-Type': 'application/json' }
    });
    results.portalStoreLocator.ok = res.ok;
    results.portalStoreLocator.status = res.status;
    if (!res.ok) results.portalStoreLocator.error = await res.text().catch(() => null);
  } catch (e: any) {
    results.portalStoreLocator.error = e?.message || String(e);
  }

  return json({ success: true, results });
}


