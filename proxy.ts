import { NextRequest, NextResponse } from "next/server";
import {
  verifySession,
  createSession,
  sessionCookieAttrs,
  SESSION_DURATION_SECONDS,
  SESSION_REFRESH_THRESHOLD,
} from "@/lib/auth/session";

const PUBLIC_API_PREFIX = "/api/auth";

export default async function proxy(req: NextRequest) {
  const pathname = req.nextUrl.pathname;

  if (pathname.startsWith(PUBLIC_API_PREFIX)) return NextResponse.next();
  if (pathname === "/health") return NextResponse.next();

  const session = await verifySession(req);

  if (pathname === "/login") {
    // Already authenticated — redirect away to avoid confusion
    if (session) return NextResponse.redirect(new URL("/dashboard", req.nextUrl.origin));
    // Not authenticated — let them through to the login page
    return NextResponse.next();
  }

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const res = NextResponse.next();

  // Sliding window: if the session has less than SESSION_REFRESH_THRESHOLD seconds
  // left, silently re-issue a fresh 24h cookie so active users are never logged out.
  const nowSec = Math.floor(Date.now() / 1000);
  if (session.exp !== undefined && session.exp - nowSec < SESSION_REFRESH_THRESHOLD) {
    const { exp: _exp, ...userFields } = session;
    const refreshed = await createSession(userFields);
    res.cookies.set({ ...sessionCookieAttrs(SESSION_DURATION_SECONDS), value: refreshed });
  }

  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
