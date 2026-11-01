"use client";

import { motion } from "motion/react";

import { pageEnter } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * Canvas page header: 32px title → 4px → muted description, actions on the
 * right (one primary only). Fades up on enter.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.header
      variants={pageEnter}
      initial="hidden"
      animate="show"
      className={cn("flex flex-col gap-4 border-b border-divider pb-6 md:flex-row md:items-end md:justify-between", className)}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-display text-foreground">{title}</h1>
        {description && <p className="text-body text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </motion.header>
  );
}
