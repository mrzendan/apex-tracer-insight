import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState, type FormEvent } from "react";
import { RouteGuard } from "@/components/auth/RouteGuard";
import { supabase } from "@/integrations/supabase/client";
import {
  createUserAccount,
  setUserRole,
  deleteUserAccount,
} from "@/lib/admin-users.functions";
import {
  createInvite,
  listInvites,
  deleteInvite,
} from "@/lib/invites.functions";
import type { AppRole } from "@/lib/auth";

export const Route = createFileRoute("/admin/users")({
  component: () => (
    <RouteGuard min="administrator">
      <UsersPage />
    </RouteGuard>
  ),
});

type Row = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  role: AppRole | null;
};

function UsersPage() {
  const create = useServerFn(createUserAccount);
  const setRole = useServerFn(setUserRole);
  const del = useServerFn(deleteUserAccount);
  const invCreate = useServerFn(createInvite);
  const invList = useServerFn(listInvites);
  const invDelete = useServerFn(deleteInvite);

  const [tab, setTab] = useState<"accounts" | "invites">("accounts");

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRoleVal] = useState<AppRole>("user");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: profiles, error: pErr }, { data: roles, error: rErr }] = await Promise.all([
      supabase.from("profiles").select("id, email, display_name, created_at"),
      supabase.from("user_roles").select("user_id, role"),
    ]);
    if (pErr || rErr) {
      setError(pErr?.message ?? rErr?.message ?? "Failed to load");
      setLoading(false);
      return;
    }
    const roleMap = new Map<string, AppRole>();
    for (const r of roles ?? []) {
      const cur = roleMap.get(r.user_id);
      const next = r.role as AppRole;
      const rank = { user: 1, operator: 2, administrator: 3 } as const;
      if (!cur || rank[next] > rank[cur]) roleMap.set(r.user_id, next);
    }
    setRows(
      (profiles ?? []).map((p) => ({
        ...p,
        role: roleMap.get(p.id) ?? null,
      })),
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await create({
        data: {
          email,
          password,
          display_name: displayName || undefined,
          role,
        },
      });
      setEmail("");
      setPassword("");
      setDisplayName("");
      setRoleVal("user");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onChangeRole(userId: string, next: AppRole) {
    try {
      await setRole({ data: { user_id: userId, role: next } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  async function onDelete(userId: string, email: string | null) {
    if (!confirm(`Delete user ${email ?? userId}? This cannot be undone.`)) return;
    try {
      await del({ data: { user_id: userId } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <header className="flex h-14 shrink-0 items-center border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">Users</h1>
        <div className="ml-6 flex gap-1">
          <TabBtn active={tab === "accounts"} onClick={() => setTab("accounts")}>
            Accounts
          </TabBtn>
          <TabBtn active={tab === "invites"} onClick={() => setTab("invites")}>
            Invites
          </TabBtn>
        </div>
        <div className="ml-auto label-eyebrow text-[10px]">Administrator only</div>
      </header>

      {tab === "accounts" && (
      <div className="space-y-6 p-6">
        <section className="hud-panel p-4">
          <h2 className="label-eyebrow mb-3">Create account</h2>
          <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-5">
            <Field label="Email">
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-9 w-full rounded-sm border border-border bg-surface-2 px-2 text-xs outline-none focus:border-primary"
              />
            </Field>
            <Field label="Password">
              <input
                type="text"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="h-9 w-full rounded-sm border border-border bg-surface-2 px-2 text-xs outline-none focus:border-primary"
              />
            </Field>
            <Field label="Display name">
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="h-9 w-full rounded-sm border border-border bg-surface-2 px-2 text-xs outline-none focus:border-primary"
              />
            </Field>
            <Field label="Role">
              <select
                value={role}
                onChange={(e) => setRoleVal(e.target.value as AppRole)}
                className="h-9 w-full rounded-sm border border-border bg-surface-2 px-2 text-xs outline-none focus:border-primary"
              >
                <option value="user">User</option>
                <option value="operator">Operator</option>
                <option value="administrator">Administrator</option>
              </select>
            </Field>
            <div className="flex items-end">
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-sm bg-primary px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                {busy ? "Creating…" : "Create"}
              </button>
            </div>
          </form>
          {error && (
            <div className="mt-3 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </div>
          )}
        </section>

        <section className="hud-panel">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <h2 className="label-eyebrow">Accounts</h2>
            <span className="text-mono text-[10px] text-muted-foreground">
              {loading ? "loading…" : `${rows.length} total`}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-left label-eyebrow text-[10px]">
                <tr>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Display name</th>
                  <th className="px-3 py-2">Role</th>
                  <th className="px-3 py-2">Created</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-[11px]">{r.email}</td>
                    <td className="px-3 py-2">{r.display_name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <select
                        value={r.role ?? "user"}
                        onChange={(e) => onChangeRole(r.id, e.target.value as AppRole)}
                        className="h-7 w-full rounded-sm border border-border bg-surface-2 px-2 text-[11px] outline-none focus:border-primary"
                      >
                        <option value="user">User</option>
                        <option value="operator">Operator</option>
                        <option value="administrator">Administrator</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onDelete(r.id, r.email)}
                        className="rounded-sm border border-destructive/40 px-2 py-1 text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/10"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No accounts yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      )}

      {tab === "invites" && (
        <InvitesTab
          invCreate={invCreate}
          invList={invList}
          invDelete={invDelete}
        />
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1">
      <div className="label-eyebrow text-[10px]">{label}</div>
      {children}
    </label>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-sm px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
        active
          ? "bg-primary text-primary-foreground"
          : "text-muted-foreground hover:bg-surface-2 hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

type InviteRow = {
  id: string;
  email: string;
  role: AppRole;
  token: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
};

function InvitesTab({
  invCreate,
  invList,
  invDelete,
}: {
  invCreate: ReturnType<typeof useServerFn<typeof createInvite>>;
  invList: ReturnType<typeof useServerFn<typeof listInvites>>;
  invDelete: ReturnType<typeof useServerFn<typeof deleteInvite>>;
}) {
  const [rows, setRows] = useState<InviteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("user");
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const r = await invList();
      setRows((r.invites ?? []) as InviteRow[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await invCreate({ data: { email, role, expires_in_days: days } });
      setEmail("");
      setRole("user");
      setDays(7);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm("Revoke this invite?")) return;
    try {
      await invDelete({ data: { id } });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  }

  function linkFor(token: string) {
    if (typeof window === "undefined") return `/accept-invite?token=${token}`;
    return `${window.location.origin}/accept-invite?token=${token}`;
  }

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(linkFor(token));
      setCopied(token);
      setTimeout(() => setCopied((c) => (c === token ? null : c)), 1500);
    } catch {
      // ignore
    }
  }

  function statusOf(r: InviteRow): { label: string; cls: string } {
    if (r.used_at) return { label: "Used", cls: "text-muted-foreground" };
    if (new Date(r.expires_at).getTime() < Date.now())
      return { label: "Expired", cls: "text-destructive" };
    return { label: "Active", cls: "text-primary" };
  }

  return (
    <div className="space-y-6 p-6">
      <section className="hud-panel p-4">
        <h2 className="label-eyebrow mb-3">Create invite link</h2>
        <form onSubmit={onCreate} className="grid gap-3 md:grid-cols-5">
          <Field label="Email">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-9 w-full rounded-sm border border-border bg-surface-2 px-2 text-xs outline-none focus:border-primary"
            />
          </Field>
          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
              className="h-9 w-full rounded-sm border border-border bg-surface-2 px-2 text-xs outline-none focus:border-primary"
            >
              <option value="user">User</option>
              <option value="operator">Operator</option>
              <option value="administrator">Administrator</option>
            </select>
          </Field>
          <Field label="Expires (days)">
            <input
              type="number"
              min={1}
              max={30}
              value={days}
              onChange={(e) => setDays(Number(e.target.value) || 7)}
              className="h-9 w-full rounded-sm border border-border bg-surface-2 px-2 text-xs outline-none focus:border-primary"
            />
          </Field>
          <div className="flex items-end md:col-span-2">
            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-sm bg-primary px-3 py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Creating…" : "Create invite"}
            </button>
          </div>
        </form>
        {error && (
          <div className="mt-3 rounded-sm border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </section>

      <section className="hud-panel">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h2 className="label-eyebrow">Invites</h2>
          <span className="text-mono text-[10px] text-muted-foreground">
            {loading ? "loading…" : `${rows.length} total`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-surface-2 text-left label-eyebrow text-[10px]">
              <tr>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Role</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Expires</th>
                <th className="px-3 py-2">Link</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const s = statusOf(r);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-[11px]">{r.email}</td>
                    <td className="px-3 py-2">{r.role}</td>
                    <td className={`px-3 py-2 font-bold ${s.cls}`}>{s.label}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {new Date(r.expires_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => copyLink(r.token)}
                        disabled={!!r.used_at}
                        className="rounded-sm border border-border px-2 py-1 text-[10px] uppercase tracking-wider hover:bg-surface-2 disabled:opacity-40"
                      >
                        {copied === r.token ? "Copied!" : "Copy link"}
                      </button>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => onDelete(r.id)}
                        className="rounded-sm border border-destructive/40 px-2 py-1 text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/10"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">
                    No invites yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}