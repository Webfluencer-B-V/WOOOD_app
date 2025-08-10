import type { LoaderFunctionArgs } from '@remix-run/cloudflare';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const base = url.origin.replace(/\/$/, '');
  if (!shop) {
    console.error('[AuthDebug] auth.redirect missing shop');
    return new Response('Missing shop', { status: 500 });
  }
  const target = `${base}/install?shop=${encodeURIComponent(shop)}`;
  console.log('[AuthDebug] auth.redirect top redirect', { target });
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>Redirecting…</title></head><body>
  <script>window.top.location.href = ${JSON.stringify(target)};</script>
  </body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default function AuthRedirect() { return null; }


