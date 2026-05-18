import { createFileRoute, useNavigate, Navigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    redirect: typeof s.redirect === "string" ? s.redirect : "/",
  }),
  component: LoginPage,
  head: () => ({ meta: [{ title: "Sign in — Apex Stats" }] }),
});

function LoginPage() {
  const { user, signIn, loading } = useAuth();
  const { redirect } = Route.useSearch();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={redirect as "/"} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await signIn(email, password);
    setBusy(false);
    if (err) setError(err);
    else navigate({ to: redirect as "/" });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <form
        onSubmit={onSubmit}
        className="hud-panel w-full max-w-sm space-y-4 p-6"
      >
        <div>
          <div className="label-eyebrow text-xs">Apex Stats</div>
          <h1 className="mt-1 text-lg font-bold">Sign in</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Accounts are issued by the administrator. Contact them for access.
          </p>
        </div>
        <div className="space-y-2">
          <label className="label-eyebrow text-xs" htmlFor="email">Email</label>
          <input
            id="email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        <div className="space-y-2">
          <label className="label-eyebrow text-xs" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-sm border border-border bg-surface-2 px-3 py-2 text-sm outline-none focus:border-primary"
          />
        </div>
        {error && (
          <div className="rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-sm bg-primary px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}