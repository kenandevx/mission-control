"use client";

export function usePendingApprovalsCount() {
  return {
    count: 0,
    loading: false,
    refresh: async () => 0,
  };
}
