import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import s1 from "@/assets/slide-01-architecture.png";
import s2 from "@/assets/slide-02-dataflow.png";
import s3 from "@/assets/slide-03-cv-pipeline.png";
import s4 from "@/assets/slide-04-user-flow.png";
import s5 from "@/assets/slide-05-domain-model.png";
import s6 from "@/assets/slide-06-er-diagram.png";
import s7 from "@/assets/slide-07-manual-vs-auto.png";
import s8 from "@/assets/slide-08-tech-stack.png";
import s9 from "@/assets/slide-09-user-flow-detailed.png";

export const Route = createFileRoute("/presentation")({
  head: () => ({
    meta: [
      { title: "Apex Stats — Презентация платформы" },
      { name: "description", content: "Архитектура, пайплайн компьютерного зрения, модель данных и пользовательский сценарий Apex Stats." },
      { property: "og:title", content: "Apex Stats — Презентация платформы" },
      { property: "og:description", content: "Как видео матчей Apex Legends превращается в интерактивную аналитику." },
    ],
  }),
  component: PresentationPage,
});

type Slide = { src: string; title: string; subtitle: string };

const slides: Slide[] = [
  { src: s1, title: "Архитектура верхнего уровня", subtitle: "Как данные из матчей Apex Legends превращаются в интерактивную аналитику." },
  { src: s2, title: "Диаграмма потока данных", subtitle: "Путь видеоданных от VOD до интерактивной аналитики." },
  { src: s3, title: "Конвейер компьютерного зрения", subtitle: "Как видеокадр превращается в координаты и игровые события." },
  { src: s4, title: "Пользовательский сценарий", subtitle: "От выбора матча до получения инсайтов." },
  { src: s5, title: "Предметная модель", subtitle: "Ключевые сущности и связи внутри системы." },
  { src: s6, title: "ER-диаграмма базы данных", subtitle: "Упрощённая структура таблиц и связей." },
  { src: s7, title: "Ручной vs автоматизированный анализ", subtitle: "Сравнение традиционного разбора и подхода Apex Stats." },
  { src: s8, title: "Технологический стек", subtitle: "Ключевые технологии, на которых построена платформа." },
  { src: s9, title: "Пользовательский сценарий — детали", subtitle: "Подробный разбор интерфейса дашборда аналитика." },
];

function PresentationPage() {
  const [i, setI] = useState(0);
  const [overview, setOverview] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const go = useCallback((n: number) => setI((c) => Math.max(0, Math.min(slides.length - 1, n))), []);
  const next = useCallback(() => go(i + 1), [i, go]);
  const prev = useCallback(() => go(i - 1), [i, go]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") { e.preventDefault(); next(); }
      else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); prev(); }
      else if (e.key === "Home") setI(0);
      else if (e.key === "End") setI(slides.length - 1);
      else if (e.key.toLowerCase() === "g") setOverview((o) => !o);
      else if (e.key.toLowerCase() === "f") {
        const el = wrapRef.current;
        if (!document.fullscreenElement) el?.requestFullscreen?.();
        else document.exitFullscreen?.();
      } else if (e.key === "Escape") setOverview(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  const cur = slides[i];

  return (
    <div ref={wrapRef} className="relative flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
      {/* Top bar */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <Link to="/" className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground">← Home</Link>
        <div className="text-[11px] font-bold uppercase tracking-wider">Apex Stats · Presentation</div>
        <div className="text-mono ml-2 text-[10px] text-muted-foreground">{i + 1} / {slides.length}</div>
        <div className="ml-auto flex items-center gap-2 text-[10px] uppercase tracking-wider text-muted-foreground">
          <button onClick={() => setOverview((o) => !o)} className="rounded-sm border border-border bg-surface-2 px-2 py-1 hover:bg-muted">{overview ? "Slide" : "Grid (G)"}</button>
          <button onClick={() => {
            const el = wrapRef.current;
            if (!document.fullscreenElement) el?.requestFullscreen?.();
            else document.exitFullscreen?.();
          }} className="rounded-sm border border-border bg-surface-2 px-2 py-1 hover:bg-muted">Fullscreen (F)</button>
        </div>
      </header>

      {!overview ? (
        <>
          {/* Slide stage */}
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black px-6 py-6">
            <img
              src={cur.src}
              alt={cur.title}
              className="max-h-full max-w-full rounded-md object-contain shadow-[0_20px_60px_-20px_rgba(0,0,0,0.8)]"
              draggable={false}
            />

            {/* Nav arrows */}
            <button onClick={prev} disabled={i === 0}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full border border-border bg-surface/80 px-3 py-2 text-sm backdrop-blur transition hover:bg-surface disabled:opacity-30">‹</button>
            <button onClick={next} disabled={i === slides.length - 1}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full border border-border bg-surface/80 px-3 py-2 text-sm backdrop-blur transition hover:bg-surface disabled:opacity-30">›</button>

            {/* Caption */}
            <div className="pointer-events-none absolute bottom-4 left-1/2 -translate-x-1/2 rounded-md border border-border bg-surface/80 px-4 py-2 text-center backdrop-blur">
              <div className="text-[11px] font-bold uppercase tracking-wider">{cur.title}</div>
              <div className="text-[10px] text-muted-foreground">{cur.subtitle}</div>
            </div>
          </div>

          {/* Thumbnail strip */}
          <footer className="flex h-24 shrink-0 items-center gap-2 overflow-x-auto border-t border-border bg-surface px-3 py-2">
            {slides.map((sl, idx) => (
              <button key={idx} onClick={() => setI(idx)}
                className={`relative h-full shrink-0 overflow-hidden rounded-sm border transition ${idx === i ? "border-primary ring-1 ring-primary/40" : "border-border hover:border-muted-foreground"}`}
                style={{ aspectRatio: "16 / 9" }}>
                <img src={sl.src} alt={sl.title} className="h-full w-full object-cover" draggable={false} />
                <span className="absolute left-1 top-1 rounded-sm bg-black/60 px-1 text-[9px] font-bold text-white">{idx + 1}</span>
              </button>
            ))}
          </footer>
        </>
      ) : (
        <div className="grid flex-1 auto-rows-min grid-cols-1 gap-4 overflow-y-auto bg-black p-6 sm:grid-cols-2 lg:grid-cols-3">
          {slides.map((sl, idx) => (
            <button key={idx} onClick={() => { setI(idx); setOverview(false); }}
              className={`group overflow-hidden rounded-md border bg-surface text-left transition hover:-translate-y-0.5 hover:shadow-xl ${idx === i ? "border-primary" : "border-border"}`}>
              <div className="relative" style={{ aspectRatio: "16 / 9" }}>
                <img src={sl.src} alt={sl.title} className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                <span className="absolute left-2 top-2 rounded-sm bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-white">{idx + 1}</span>
              </div>
              <div className="border-t border-border p-3">
                <div className="text-[11px] font-bold uppercase tracking-wider">{sl.title}</div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">{sl.subtitle}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
