import { useMemo, useState } from "react";

export type FieldType = "text" | "number" | "color" | "select" | "list" | "readonly";

export type ColumnDef<T> = {
  key: keyof T & string;
  label: string;
  type?: FieldType;
  options?: { value: string; label: string }[];
  width?: string;
  align?: "left" | "right";
  render?: (row: T) => React.ReactNode;
};

type Props<T extends { id: string }> = {
  title: string;
  rows: T[];
  columns: ColumnDef<T>[];
  createEmpty: () => T;
  onChange: (rows: T[]) => void;
};

export function CrudTable<T extends { id: string }>({ title, rows, columns, createEmpty, onChange }: Props<T>) {
  const [editing, setEditing] = useState<T | null>(null);

  const startCreate = () => setEditing(createEmpty());
  const startEdit = (row: T) => setEditing({ ...row });
  const remove = (id: string) => {
    if (!confirm("Delete this entry?")) return;
    onChange(rows.filter((r) => r.id !== id));
  };
  const save = () => {
    if (!editing) return;
    const exists = rows.some((r) => r.id === editing.id);
    onChange(exists ? rows.map((r) => (r.id === editing.id ? editing : r)) : [...rows, editing]);
    setEditing(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <h1 className="text-sm font-bold uppercase tracking-wider">{title}</h1>
        <button
          onClick={startCreate}
          className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110"
        >
          + New
        </button>
      </header>

      <div className="flex-1 overflow-auto p-6">
        <div className="hud-panel overflow-hidden">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface-2">
              <tr className="text-left label-eyebrow text-xs">
                {columns.map((c) => (
                  <th key={c.key} className={`px-3 py-2 ${c.align === "right" ? "text-right" : ""}`} style={{ width: c.width }}>{c.label}</th>
                ))}
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-border last:border-0 hover:bg-surface-2">
                  {columns.map((c) => (
                    <td key={c.key} className={`px-3 py-2 text-xs ${c.align === "right" ? "text-right tabular-nums text-mono" : ""}`}>
                      {c.render ? c.render(row) : renderCell(row[c.key], c.type)}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right text-xs">
                    <button onClick={() => startEdit(row)} className="mr-1 rounded-sm border border-border bg-surface px-2 py-1 hover:bg-muted">Edit</button>
                    <button onClick={() => remove(row.id)} className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-destructive hover:bg-destructive/10">Delete</button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center text-xs text-muted-foreground">No entries</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <EditDialog
          row={editing}
          columns={columns}
          isNew={!rows.some((r) => r.id === editing.id)}
          onChange={setEditing}
          onCancel={() => setEditing(null)}
          onSave={save}
        />
      )}
    </div>
  );
}

function renderCell(val: unknown, type?: FieldType): React.ReactNode {
  if (val == null) return <span className="text-muted-foreground">—</span>;
  if (type === "color" && typeof val === "string") {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-4 w-4 rounded-sm border border-border" style={{ background: val }} />
        <span className="text-mono">{val}</span>
      </span>
    );
  }
  if (Array.isArray(val)) return val.join(", ");
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

function EditDialog<T extends { id: string }>({ row, columns, isNew, onChange, onCancel, onSave }: {
  row: T; columns: ColumnDef<T>[]; isNew: boolean;
  onChange: (r: T) => void; onCancel: () => void; onSave: () => void;
}) {
  const fields = useMemo(() => columns.filter((c) => c.type !== "readonly"), [columns]);
  const update = (key: string, value: unknown) => onChange({ ...row, [key]: value });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="hud-panel w-full max-w-lg bg-surface" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-bold uppercase tracking-wider">{isNew ? "New entry" : "Edit entry"}</h2>
        </div>
        <div className="max-h-[60vh] space-y-3 overflow-auto p-4">
          {fields.map((c) => (
            <div key={c.key}>
              <label className="label-eyebrow text-xs">{c.label}</label>
              <FieldInput
                type={c.type ?? "text"}
                value={(row as Record<string, unknown>)[c.key]}
                options={c.options}
                onChange={(v) => update(c.key, v)}
              />
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-2 px-4 py-3">
          <button onClick={onCancel} className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs uppercase tracking-wider hover:bg-muted">Cancel</button>
          <button onClick={onSave} className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110">Save</button>
        </div>
      </div>
    </div>
  );
}

function FieldInput({ type, value, options, onChange }: {
  type: FieldType; value: unknown; options?: { value: string; label: string }[]; onChange: (v: unknown) => void;
}) {
  const base = "mt-1 w-full rounded-sm border border-border bg-background px-2 py-1.5 text-sm";
  if (type === "number") {
    return <input type="number" className={base} value={Number(value ?? 0)} onChange={(e) => onChange(Number(e.target.value))} />;
  }
  if (type === "color") {
    return (
      <div className="mt-1 flex items-center gap-2">
        <input type="color" value={String(value ?? "#ffffff")} onChange={(e) => onChange(e.target.value)} className="h-9 w-12 rounded-sm border border-border bg-background" />
        <input type="text" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="flex-1 rounded-sm border border-border bg-background px-2 py-1.5 text-sm text-mono" />
      </div>
    );
  }
  if (type === "select") {
    return (
      <select className={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (type === "list") {
    const arr = Array.isArray(value) ? value as string[] : [];
    return <input type="text" className={base} value={arr.join(", ")} onChange={(e) => onChange(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} placeholder="Comma-separated" />;
  }
  return <input type="text" className={base} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} />;
}