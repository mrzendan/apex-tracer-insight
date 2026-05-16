import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { addSlide, moveSlide, removeSlide, updateSlide, usePlanning } from "@/lib/planning-store";

export const Route = createFileRoute("/admin/planning/slides")({ component: SlidesPage });

function SlidesPage() {
  const { slides } = usePlanning();
  const [selectedId, setSelectedId] = useState<string>(slides[0]?.id ?? "");
  const [presenting, setPresenting] = useState(false);
  const [presentIdx, setPresentIdx] = useState(0);

  useEffect(() => {
    if (!slides.find((s) => s.id === selectedId)) setSelectedId(slides[0]?.id ?? "");
  }, [slides, selectedId]);
  const current = slides.find((s) => s.id === selectedId);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPresenting(false);
      if (e.key === "ArrowRight" || e.key === " ") setPresentIdx((i) => Math.min(slides.length - 1, i + 1));
      if (e.key === "ArrowLeft") setPresentIdx((i) => Math.max(0, i - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting, slides.length]);

  if (presenting) {
    const s = slides[presentIdx] ?? slides[0];
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-black text-white">
        <div className="absolute right-4 top-4 flex items-center gap-3 text-mono text-[11px] text-white/60">
          <span>{presentIdx + 1} / {slides.length}</span>
          <button onClick={() => setPresenting(false)} className="rounded-sm border border-white/20 px-2 py-1 hover:bg-white/10">Exit (Esc)</button>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-16">
          <h1 className="mb-10 text-center text-6xl font-bold tracking-tight">{s?.title}</h1>
          <pre className="max-w-4xl whitespace-pre-wrap text-center text-2xl leading-relaxed text-white/80" style={{ fontFamily: "inherit" }}>{s?.body}</pre>
        </div>
        <div className="flex justify-center gap-3 pb-6">
          <button onClick={() => setPresentIdx((i) => Math.max(0, i - 1))} className="rounded-sm border border-white/20 px-3 py-1 text-xs hover:bg-white/10">Prev</button>
          <button onClick={() => setPresentIdx((i) => Math.min(slides.length - 1, i + 1))} className="rounded-sm border border-white/20 px-3 py-1 text-xs hover:bg-white/10">Next</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold uppercase tracking-wider">Presentation slides</h1>
          <span className="text-mono text-[10px] text-muted-foreground">· {slides.length} slide{slides.length === 1 ? "" : "s"} · auto-saved locally</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { const id = addSlide(); setSelectedId(id); }}
            className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-primary-foreground hover:brightness-110"
          >
            + Slide
          </button>
          <button
            disabled={!slides.length}
            onClick={() => { setPresentIdx(Math.max(0, slides.findIndex((s) => s.id === selectedId))); setPresenting(true); }}
            className="rounded-sm border border-border bg-surface px-3 py-1.5 text-xs font-semibold uppercase tracking-wider hover:bg-muted disabled:opacity-40"
          >
            Present
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="w-64 shrink-0 overflow-auto border-r border-border bg-surface">
          <ul className="space-y-1 p-2">
            {slides.map((s, i) => (
              <li key={s.id}>
                <button
                  onClick={() => setSelectedId(s.id)}
                  className={`flex w-full items-start gap-2 rounded-sm border px-2 py-2 text-left text-xs transition-colors ${s.id === selectedId ? "border-primary/40 bg-primary/10" : "border-border bg-surface-2 hover:bg-muted"}`}
                >
                  <span className="text-mono shrink-0 pt-0.5 text-[10px] text-muted-foreground">{String(i + 1).padStart(2, "0")}</span>
                  <span className="flex-1 truncate font-semibold">{s.title || "Untitled"}</span>
                </button>
                {s.id === selectedId && (
                  <div className="mt-1 flex gap-1 px-2">
                    <button onClick={() => moveSlide(s.id, -1)} disabled={i === 0} className="flex-1 rounded-sm border border-border bg-surface px-1 py-0.5 text-[10px] hover:bg-muted disabled:opacity-40">Up</button>
                    <button onClick={() => moveSlide(s.id, 1)} disabled={i === slides.length - 1} className="flex-1 rounded-sm border border-border bg-surface px-1 py-0.5 text-[10px] hover:bg-muted disabled:opacity-40">Dn</button>
                    <button onClick={() => { if (confirm("Delete slide?")) removeSlide(s.id); }} className="flex-1 rounded-sm border border-destructive/40 bg-surface px-1 py-0.5 text-[10px] text-destructive hover:bg-destructive/10">Del</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </aside>

        {current ? (
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 p-3">
            <div className="hud-panel flex min-h-0 flex-col overflow-hidden">
              <div className="border-b border-border bg-surface px-3 py-1.5">
                <div className="label-eyebrow text-[10px]">Editor</div>
              </div>
              <input
                value={current.title}
                onChange={(e) => updateSlide(current.id, { title: e.target.value })}
                placeholder="Slide title"
                className="border-b border-border bg-background px-4 py-3 text-xl font-bold outline-none"
              />
              <textarea
                value={current.body}
                onChange={(e) => updateSlide(current.id, { body: e.target.value })}
                placeholder="Slide content (plain text, line breaks preserved)"
                spellCheck={false}
                className="text-mono flex-1 resize-none bg-background p-4 text-sm leading-relaxed outline-none"
              />
            </div>
            <div className="hud-panel flex min-h-0 flex-col overflow-hidden bg-background">
              <div className="border-b border-border bg-surface px-3 py-1.5">
                <div className="label-eyebrow text-[10px]">Preview · 16:9</div>
              </div>
              <div className="flex flex-1 items-center justify-center p-4">
                <div className="relative w-full overflow-hidden rounded-sm border border-border bg-black text-white shadow-xl" style={{ aspectRatio: "16 / 9" }}>
                  <div className="absolute inset-0 flex flex-col items-center justify-center px-10 text-center">
                    <h2 className="mb-6 text-3xl font-bold tracking-tight">{current.title}</h2>
                    <pre className="whitespace-pre-wrap text-center text-sm leading-relaxed text-white/75" style={{ fontFamily: "inherit" }}>{current.body}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-xs text-muted-foreground">No slides yet. Click + Slide to start.</div>
        )}
      </div>
    </div>
  );
}