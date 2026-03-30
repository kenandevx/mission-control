"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { ContainerLoader } from "@/components/ui/container-loader";

type FadeInProps = {
  children: ReactNode;
  delay?: number;
  className?: string;
  withLoader?: boolean;
};

export function FadeIn({ children, delay = 0, className, withLoader = true }: FadeInProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const extraDelayMs = Math.max(0, delay * 1000);
    const minRevealMs = withLoader ? 200 : 0;
    const timer = setTimeout(() => setEntered(true), minRevealMs + extraDelayMs);
    return () => clearTimeout(timer);
  }, [delay, withLoader]);

  return (
    <div className={className ? `relative ${className}` : "relative"}>
      <div
        style={{
          opacity: entered ? 1 : 0,
          transition: "opacity 220ms cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {children}
      </div>

      {withLoader && !entered ? <ContainerLoader /> : null}
    </div>
  );
}
