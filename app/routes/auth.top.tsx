import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { useEffect } from 'react';
import { useLoaderData } from '@remix-run/react';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const shop = url.searchParams.get('shop');
  const base = process.env.CLOUDFLARE_URL?.replace(/\/$/, '');
  if (!shop || !base) {
    throw new Response('Missing shop or CLOUDFLARE_URL', { status: 500 });
  }
  return json({ target: `${base}/install?shop=${encodeURIComponent(shop)}` });
}

export default function TopAuth() {
  const { target } = useLoaderData<typeof loader>();
  
  useEffect(() => {
    // Use window.top.location.href to break out of iframe
    if (typeof window !== 'undefined' && window.top) {
      window.top.location.href = target;
    }
  }, [target]);
  
  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <p>Redirecting to authentication...</p>
      <p>If you're not redirected automatically, <a href={target} target="_top">click here</a></p>
    </div>
  );
}


