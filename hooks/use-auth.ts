"use client";

import { useEffect, useState } from "react";

export type AuthUser = {
  sub: string;
  name: string;
  email: string;
};

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok: boolean; user?: AuthUser } | null) => {
        setUser(data?.user ?? null);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return { user, loading };
}
