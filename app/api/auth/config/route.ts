import { NextResponse } from "next/server";

/**
 * GET /api/auth/config
 * Returns Azure AD client config to the browser at runtime.
 * These values are non-secret (they appear in the OAuth URL anyway),
 * but serving them server-side means the build never needs them baked in.
 * This endpoint is intentionally public — it is listed in PUBLIC_API_PREFIX in proxy.ts.
 */
export async function GET() {
  const clientId = process.env.AZURE_AD_CLIENT_ID;
  const tenantId = process.env.AZURE_AD_TENANT_ID;

  if (!clientId || !tenantId) {
    return NextResponse.json(
      { ok: false, error: "Auth not configured — set AZURE_AD_CLIENT_ID and AZURE_AD_TENANT_ID in .env" },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true, clientId, tenantId });
}
