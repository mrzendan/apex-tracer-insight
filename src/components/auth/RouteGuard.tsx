import { type ReactNode } from "react";
import { Navigate } from "@tanstack/react-router";
import { hasAtLeast, useAuth, type AppRole } from "@/lib/auth";

export function RouteGuard({ min, children }: { min: AppRole; children: ReactNode }) {
  const { loading, user, role } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground text-xs uppercase tracking-wider">
        Loading…
      </div>
    );
  }
  if (!user) return <Navigate to="/login" search={{ redirect: location.pathname }} replace />;
  if (!hasAtLeast(role, min)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-background px-4 text-center">
        <h1 className="text-lg font-bold">Access denied</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          Your role ({role ?? "none"}) does not have permission to view this page. Required: {min}.
        </p>
      </div>
    );
  }
  return <>{children}</>;
}