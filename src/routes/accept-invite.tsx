import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { lookupInvite, acceptInvite } from "@/lib/invites.functions";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/accept-invite")({
  validateSearch: (s: Record<string, unknown>) => ({
    token: typeof s.token === "string" ? s.token : "",
  }),
  component: AcceptInvitePage,
  head: () => ({ meta: [{ title: "Accept invite — Apex Stats" }] }),
});

type Status =
  | { kind: "loading" }
  | { kind: "ok"; email: string; role: string }
  | { kind: "used" | "expired" | "invalid" | "no-token" }
  | { kind: "error"; message: string };

function AcceptInvitePage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const lookup = useServerFn(lookupInvite);
  const accept = useServerFn(acceptInvite);

  const [status, setStatus] = useState<Status>({ kind: "loading" });
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus({ kind: "no-token" });
      return;
    }
    lookup({ data: { token } })
      .then((r) => {
        if (r.status === "ok") setStatus({ kind: "ok", email: r.email, role: r.role });
        else setStatus({ kind: r.status });
      })
      .catch((e) => setStatus({ kind: "error", message: e instanceof Error ? e.message : "Failed" }));
  }, [token, lookup]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (status.kind !== "ok") return;
    setBusy(true);
    setError(null);
    try {
      await accept({ data: { token, password, display_name: displayName || undefined } });
      await signIn(status.email, password);
      navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="hud-panel w-full max-w-sm space-y-4 p-6">
        <div>
          <div className="label-eyebrow text-xs">Apex Stats</div>
          <h1 className="mt-1 text-lg font-bold">Accept invite</h1>
        </div>

        {status.kind === "loading" && (
          <p className="text-xs text-muted-foreground">Checking invite…</p>
        )}
        {status.kind === "no-token" && (
          <p className="text-xs text-destructive">No invite token in the link.</p>
        )}
        {status.kind === "invalid" && (
          <p className="text-xs text-destructive">This invite link is invalid.</p>
        )}
        {status.kind === "expired" && (
          <p className="text-xs text-destructive">This invite has expired. Ask the administrator for a new one.</p>
        )}
        {status.kind === "used" && (
          <p className="text-xs text-destructive">This invite has already been used.</p>
        )}
        {status.kind === "error" && (
          <p className="text-xs text-destructive">{status.message}</p>
        )}

        {status.kind === "ok" && (
          <form onSubmit={onSubmit} className="space-y-3">
            <div className="rounded-sm border border-border bg-surface-2 p-3 text-xs">
              <div className="label-eyebrow text-xs">Invited as</div>
              <div className="mt-1 font-mono">{status.email}</div>
              <div className="mt-1 text-muted-foreground">role: {status.role}</div>
            </div>
            <div className="space-y-1">
              <label className="label-eyebrow text-xs">Display name (optional)</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-9 w-full rounded-sm border border-border bg-surface-2 px-2 text-xs outline-none focus:border-primary"
              />
            </div>
            <div className="space-y-1">
              <label className="label-eyebrow text-xs">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9 w-full rounded-sm border border-border bg-surface-2 px-2 text-xs outline-none focus:border-primary"
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
              className="w-full rounded-sm bg-primary px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}