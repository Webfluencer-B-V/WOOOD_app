import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { shopify } from '~/shopify.server';

export async function loader({ request, context }: LoaderFunctionArgs) {
  await shopify(context).authenticate.admin(request);
  return null;
}

export default function Auth() { return null; }


