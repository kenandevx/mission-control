import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AZURE_AD_CLIENT_ID!,
      tenantId: process.env.AZURE_AD_TENANT_ID!,
      // Empty string = public client (PKCE). Azure ignores client_secret when
      // "Allow public client flows" is enabled in the App Registration.
      clientSecret: "",
    }),
  ],
  pages: {
    signIn: "/login",
    error: "/login",
  },
  callbacks: {
    async session({ session, token }) {
      if (token.sub) session.user.id = token.sub;
      return session;
    },
  },
  trustHost: true,
});
