"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { PublicClientApplication } from "@azure/msal-browser";
import { IconInnerShadowTop } from "@tabler/icons-react";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"initializing" | "ready" | "signing-in">("initializing");
  const msalRef = useRef<PublicClientApplication | null>(null);

  useEffect(() => {
    // MSAL uses browser APIs — must run client-side only
    void (async () => {
      const { PublicClientApplication } = await import("@azure/msal-browser");

      const msal = new PublicClientApplication({
        auth: {
          clientId: process.env.NEXT_PUBLIC_AZURE_AD_CLIENT_ID!,
          authority: `https://login.microsoftonline.com/${process.env.NEXT_PUBLIC_AZURE_AD_TENANT_ID}`,
          redirectUri: `${window.location.origin}/login`,
        },
        cache: {
          cacheLocation: "sessionStorage",
          storeAuthStateInCookie: false,
        },
      });

      await msal.initialize();
      msalRef.current = msal;

      // Handle the redirect back from Microsoft
      const response = await msal.handleRedirectPromise();
      if (response?.idToken) {
        setStatus("signing-in");
        try {
          const res = await fetch("/api/auth/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ idToken: response.idToken }),
          });
          if (res.ok) {
            const raw = searchParams.get("callbackUrl") ?? "";
            // Only allow same-origin relative paths — never redirect to external URLs
            const callbackUrl =
              raw.startsWith("/") && !raw.startsWith("//") ? raw : "/dashboard";
            router.replace(callbackUrl);
            return;
          }
          setError("Sign-in failed. Please try again.");
        } catch {
          setError("Sign-in failed. Please try again.");
        }
        setStatus("ready");
        return;
      }

      setStatus("ready");
    })();
  }, [router, searchParams]);

  const handleSignIn = async () => {
    const msal = msalRef.current;
    if (!msal) return;
    try {
      await msal.loginRedirect({ scopes: ["openid", "profile", "email"] });
    } catch {
      setError("Could not start sign-in. Please try again.");
    }
  };

  if (status !== "ready") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <IconInnerShadowTop className="w-8 h-8 text-primary animate-spin" />
          <p className="text-sm text-muted-foreground">
            {status === "signing-in" ? "Signing you in…" : "Loading…"}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-sm px-6">
        {/* Logo + wordmark */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 border border-primary/20">
            <IconInnerShadowTop className="w-7 h-7 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-xl font-semibold tracking-tight">Mission Control</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Sign in to continue</p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        <button
          onClick={handleSignIn}
          className="w-full flex items-center justify-center gap-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors px-4 py-2.5 text-sm font-medium shadow-sm"
        >
          {/* Microsoft logo */}
          <svg width="18" height="18" viewBox="0 0 21 21" fill="none" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#F35325" />
            <rect x="11" y="1" width="9" height="9" fill="#81BC06" />
            <rect x="1" y="11" width="9" height="9" fill="#05A6F0" />
            <rect x="11" y="11" width="9" height="9" fill="#FFBA08" />
          </svg>
          Sign in with Microsoft
        </button>
      </div>
    </div>
  );
}
