import { NextRequest, NextResponse } from "next/server";

const USER = process.env.API_USER;
const PASS = process.env.API_PASS;

export function GET(request: NextRequest) {
  return handle(request);
}
export function POST(request: NextRequest) {
  return handle(request);
}
export function PUT(request: NextRequest) {
  return handle(request);
}
export function DELETE(request: NextRequest) {
  return handle(request);
}

async function handle(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Only protect API routes
  if (!path.startsWith("/api/")) {
    return NextResponse.next();
  }

  // Allow unauthenticated only if no credentials configured
  if (!USER || !PASS) {
    console.warn("[basic-auth] API_USER or API_PASS not set, allowing unauthenticated access");
    return NextResponse.next();
  }

  const auth = request.headers.get("authorization");
  if (!auth) {
    return new Response("Authentication required", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Restricted"' },
    });
  }

  const [scheme, credentials] = auth.split(" ");
  if (scheme !== "Basic") {
    return new Response("Invalid auth scheme", { status: 401 });
  }

  const decoded = Buffer.from(credentials, "base64").toString("utf8");
  const [username, password] = decoded.split(":");

  if (username !== USER || password !== PASS) {
    return new Response("Invalid credentials", { status: 401 });
  }

  return NextResponse.next();
}
