"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";

import { AuthProvider } from "@/lib/auth-context";
import { ThemeProvider } from "@/lib/theme";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { staleTime: 15_000, retry: 1 } },
      })
  );

  return (
    <ThemeProvider>
      {/* "user": follow the OS reduced-motion setting for every motion component. */}
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <AuthProvider>{children}</AuthProvider>
          {/* One toaster for the whole app; every mutation's success/error toast lands here. */}
          <Toaster position="top-center" richColors={false} closeButton />
        </QueryClientProvider>
      </MotionConfig>
    </ThemeProvider>
  );
}
