import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { ThemeToggle } from "@/components/ThemeToggle";
import { DensityToggle } from "@/components/DensityToggle";

export function UserBar({ variant = "floating" }: { variant?: "floating" | "inline" } = {}) {
  const { user, signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  if (!user) return null;
  if (pathname.startsWith("/login") || pathname.startsWith("/accept-invite")) return null;

  const inAdmin = pathname.startsWith("/admin");
  // The admin layout renders its own inline UserBar in the sidebar footer,
  // so the floating instance must hide itself there to avoid overlapping
  // page headers and toolbars.
  if (variant === "floating" && inAdmin) return null;

  const containerClass =
    variant === "floating"
      ? "fixed right-4 top-3 z-50 flex items-center gap-2"
      : "flex flex-wrap items-center gap-2";

  return (
    <div className={containerClass}>
      <ThemeToggle compact />
      <DensityToggle compact />
      <Link
        to={inAdmin ? "/" : "/admin"}
        className="text-mono rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-xs uppercase tracking-wider hover:bg-muted"
      >
        {inAdmin ? "Main" : "Admin"}
      </Link>
      <button
        onClick={() => signOut()}
        className="text-mono ml-auto rounded-sm border border-border bg-surface-2 px-2 py-1.5 text-xs uppercase tracking-wider hover:bg-muted"
      >
        Sign out
      </button>
    </div>
  );
}
