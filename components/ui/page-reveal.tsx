"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ContainerLoader } from "@/components/ui/container-loader";

type PageRevealProps = {
  children: ReactNode;
  className?: string;
  delayMs?: number;
  label?: string;
};

export function PageReveal({ children, className, delayMs = 200, label = "Loading…" }: PageRevealProps) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);

  return (
    <div className="relative">
      <motion.div
        className={className}
        initial={{ opacity: 0 }}
        animate={{ opacity: ready ? 1 : 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      >
        {children}
      </motion.div>
      {!ready ? <ContainerLoader label={label} /> : null}
    </div>
  );
}
