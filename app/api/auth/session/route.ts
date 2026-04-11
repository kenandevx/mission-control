import { NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createSession, getSession, sessionCookieAttrs, SESSION_DURATION_SECONDS } from "@/lib/auth/session";

// Lazily initialised — not evaluated at build time, only on first request.
let _jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJWKS() {
  const tenantId = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID;
  if (!tenantId) throw new Error("NEXT_PUBLIC_AZURE_AD_TENANT_ID is not set");
  if (!_jwks) {
    _jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`)
    );
  }
  return _jwks;
}

/**
 * POST /api/auth/session
 * Receives the Microsoft ID token from the browser after MSAL PKCE flow,
 * validates its signature + claims, then issues an HttpOnly session cookie.
 */
export async function POST(request: Request) {
  try {
    const tenantId = process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID;
    const clientId = process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID;
    if (!tenantId || !clientId) {
      return NextResponse.json(
        { ok: false, error: "Auth not configured" },
        { status: 503 }
      );
    }

    const { idToken } = (await request.json()) as { idToken?: string };
    if (!idToken) {
      return NextResponse.json({ ok: false, error: "Missing idToken" }, { status: 400 });
    }

    // Verify signature, issuer and audience against Microsoft's JWKS
    const { payload } = await jwtVerify(idToken, getJWKS(), {
      issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
      audience: clientId,
    });

    const sessionToken = await createSession({
      sub: payload.sub ?? "",
      name: (payload.name as string) ?? (payload.preferred_username as string) ?? "User",
      email: (payload.preferred_username as string) ?? (payload.email as string) ?? "",
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set({ ...sessionCookieAttrs(SESSION_DURATION_SECONDS), value: sessionToken });
    return res;
  } catch (error) {
    console.error("[auth] Session creation failed:", error);
    return NextResponse.json({ ok: false, error: "Invalid token" }, { status: 401 });
  }
}

/**
 * GET /api/auth/session
 * Returns the currently authenticated user from the session cookie.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, user: session });
}

/**
 * DELETE /api/auth/session
 * Destroys the session cookie (logout).
 */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set({ ...sessionCookieAttrs(0), value: "" });
  return res;
}
