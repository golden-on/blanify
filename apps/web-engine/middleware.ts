import { NextRequest, NextResponse } from "next/server";

export const config = {
  matcher: ["/((?!_next/|sites/|favicon.ico).*)"],
};

export default async function middleware(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  const domain = host.split(":")[0] ?? "";
  const path = request.nextUrl.pathname;

  const apiServerUrl = process.env.API_SERVER_URL ?? "http://localhost:4000";
  const resolveUrl = `${apiServerUrl}/api/v1/public/websites/resolve?domain=${encodeURIComponent(domain)}&path=${encodeURIComponent(path)}`;

  let resolved: unknown;
  try {
    const response = await fetch(resolveUrl);
    if (response.ok) {
      resolved = await response.json();
    }
  } catch {
    resolved = undefined;
  }

  if (!resolved || typeof resolved !== "object" || !("website" in resolved)) {
    return new NextResponse("Site not found", { status: 404 });
  }

  const { website } = resolved as { website: { id: string } };

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-site-data", JSON.stringify(resolved));

  const rewrittenUrl = request.nextUrl.clone();
  rewrittenUrl.pathname = `/sites/${website.id}${path === "/" ? "" : path}`;

  return NextResponse.rewrite(rewrittenUrl, { request: { headers: requestHeaders } });
}
