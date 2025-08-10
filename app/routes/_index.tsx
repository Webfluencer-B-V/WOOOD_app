import { redirect, type LoaderFunctionArgs } from '@remix-run/cloudflare';

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const search = url.search;
  return redirect(`/app${search}`);
}

export default function RootIndex() {
  return null;
}


