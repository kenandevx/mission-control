import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Paths that never require authentication
const PUBLIC_PATHS = new Set(["/login", "/health"]);
const PUBLIC_API_PREFIX = "/api/auth";

export default auth((req) => {
  const { nextUrl } = req;
  const isAuthenticated = !!req.auth;
  const pathname = nextUrl.pathname;

  // Always allow public paths and NextAuth's own API routes
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();
  if (pathname.startsWith(PUBLIC_API_PREFIX)) return NextResponse.next();

  if (!isAuthenticated) {
    // API calls → return 401 JSON so fetch clients get a proper error
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    // Page routes → redirect to login, preserve intended destination
    const loginUrl = new URL("/login", nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // Run on every request except Next.js internals and static files
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
