import { redirect } from "next/navigation";
import { auth, signIn } from "@/auth";
import { IconInnerShadowTop } from "@tabler/icons-react";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string; error?: string }>;
}) {
  // Already authenticated → go straight to the app
  const session = await auth();
  if (session) redirect("/dashboard");

  const { callbackUrl, error } = await searchParams;
  const destination = callbackUrl ?? "/dashboard";

  const errorMessages: Record<string, string> = {
    OAuthSignin: "Could not start the Microsoft sign-in flow. Please try again.",
    OAuthCallback: "Microsoft returned an error during sign-in. Please try again.",
    OAuthCreateAccount: "Could not create your account. Contact your administrator.",
    AccessDenied: "Your account does not have access to Mission Control.",
    Default: "An unexpected error occurred. Please try again.",
  };
  const errorMessage = error ? (errorMessages[error] ?? errorMessages.Default) : null;

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

        {/* Error banner */}
        {errorMessage && (
          <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        {/* Sign-in form — server action triggers Microsoft OAuth redirect */}
        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: destination });
          }}
        >
          <button
            type="submit"
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
        </form>
      </div>
    </div>
  );
}
