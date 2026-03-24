import { NextResponse, type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/boards/:path*",
    "/agents/:path*",
    "/logs/:path*",
    "/settings/:path*",
    "/setup/:path*",
    "/login",
  ],
};
