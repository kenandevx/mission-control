import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID ?? "",
      clientSecret: "",
      // beta.30 dropped tenantId — tenant is specified via the OIDC issuer URL
      issuer: `https://login.microsoftonline.com/${process.env.AZURE_AD_TENANT_ID ?? "common"}/v2.0`,
      // Public client: do not send client_secret in the token exchange request.
      // Azure must have "Allow public client flows" enabled in Authentication.
      client: {
        token_endpoint_auth_method: "none",
      },
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  trustHost: true,
});
