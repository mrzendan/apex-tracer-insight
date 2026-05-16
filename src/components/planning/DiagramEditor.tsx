import { useEffect, useState } from "react";
import { MermaidView } from "./MermaidView";
import { addDiagram, removeDiagram, updateDiagram, usePlanning, type Diagram } from "@/lib/planning-store";

type Kind = "architecture" | "database";

export function DiagramEditor({ kind, title }: { kind: Kind; title: string }) {
  const store = usePlanning();
  const list = store[kind];
  const [selectedId, setSelectedId] = useState<string>(list[0]?.id ?? "");
  useEffect(() => {
    if (!list.find((d) => d.id === selectedId)) setSelectedId(list[0]?.id ?? "");
  }, [list, selectedId]);
  const current = list.find((d) => d.id === selectedId);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold uppercase tracking-wider">{title}</h1>
          <span className="text-mono text-[10px] text-muted-foreground">· Mermaid · auto-saved locally</span>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="rounded-sm border border-border bg-background px-2 py-1 text-xs"
          >
            {list.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button
            onClick={() => { const id = addDiagram(kind, `Diagram ${list.length + 1}`); setSelectedId(id); }}
            className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110"
          >
            + New
          </button>
          {current && list.length > 1 && (
            <button
              onClick={() => { if (confirm(`Delete "${current.name}"?`)) removeDiagram(kind, current.id); }}
              className="rounded-sm border border-destructive/40 bg-surface px-2 py-1 text-[10px] uppercase tracking-wider text-destructive hover:bg-destructive/10"
            >
              Delete
            </button>
          )}
        </div>
      </header>

      {current ? (
        <EditorBody kind={kind} diagram={current} />
      ) : (
        <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">No diagrams yet. Click + New to start.</div>
      )}
    </div>
  );
}

function EditorBody({ kind, diagram }: { kind: Kind; diagram: Diagram }) {
  return (
    <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-3">
      <div className="hud-panel flex min-h-0 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
          <input
            value={diagram.name}
            onChange={(e) => updateDiagram(kind, diagram.id, { name: e.target.value })}
            className="w-full rounded-sm border border-transparent bg-transparent px-1 py-0.5 text-xs font-semibold focus:border-border focus:outline-none"
          />
          <span className="text-mono shrink-0 pl-2 text-[10px] text-muted-foreground">
            {new Date(diagram.updatedAt).toLocaleTimeString()}
          </span>
        </div>
        <textarea
          value={diagram.code}
          onChange={(e) => updateDiagram(kind, diagram.id, { code: e.target.value })}
          spellCheck={false}
          className="text-mono flex-1 resize-none border-0 bg-background p-3 text-[12px] leading-relaxed text-foreground outline-none"
        />
      </div>
      <div className="hud-panel flex min-h-0 flex-col overflow-hidden bg-background">
        <div className="flex items-center justify-between border-b border-border bg-surface px-3 py-1.5">
          <div className="label-eyebrow text-[10px]">Preview</div>
          <div className="text-mono text-[10px] text-muted-foreground">Mermaid</div>
        </div>
        <MermaidView code={diagram.code} />
      </div>
    </div>
  );
}