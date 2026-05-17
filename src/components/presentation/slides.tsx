import {
  FolderOpen, FileText, CloudUpload, BrainCircuit, Database, Code2, Monitor, User,
  Sliders, Flag, Target, Eye, Users, Crosshair, TrendingUp, Map as MapIcon,
  Trophy, Swords, Filter, Play, BarChart3, Route as RouteIcon, Clock, Rocket,
  Bot, Check, X, Server, Globe, ShieldCheck, GitBranch,
  Pipette, Palette, Save, LayoutGrid, Frame, Zap, Image as ImageIcon,
  Video, Activity, SlidersHorizontal, MousePointer2,
} from "lucide-react";
import type { ComponentType, ReactElement, ReactNode } from "react";
import { EditableText } from "./EditableText";
import { SlideCanvas, SlideHeader } from "./SlideCanvas";

type SlideProps = { editing: boolean };

/* ────────────────────────── shared building blocks ────────────────────────── */

function Block({
  children, className, accent = false,
}: { children: ReactNode; className?: string; accent?: boolean }) {
  return (
    <div
      className={
        "rounded-2xl border bg-surface/60 backdrop-blur-sm shadow-[0_8px_30px_-12px_rgba(0,0,0,0.6)] " +
        (accent ? "border-primary/40 " : "border-border ") +
        (className ?? "")
      }
    >
      {children}
    </div>
  );
}

function IconBubble({
  Icon, color = "cyan",
}: { Icon: ComponentType<{ className?: string; strokeWidth?: number }>; color?: "cyan" | "primary" | "success" | "destructive" | "warning" }) {
  const map: Record<string, string> = {
    cyan: "text-cyan",
    primary: "text-primary",
    success: "text-success",
    destructive: "text-destructive",
    warning: "text-warning",
  };
  return <Icon className={"h-16 w-16 " + map[color]} strokeWidth={1.6} />;
}

function Arrow({ dir = "right" }: { dir?: "right" | "down" }) {
  return (
    <div className={"flex items-center justify-center text-muted-foreground " + (dir === "down" ? "py-2" : "")}>
      <svg width={dir === "right" ? 56 : 24} height={dir === "right" ? 24 : 56} viewBox="0 0 56 24" className={dir === "down" ? "rotate-90" : ""}>
        <line x1="0" y1="12" x2="48" y2="12" stroke="currentColor" strokeWidth="2" />
        <polyline points="40,4 52,12 40,20" stroke="currentColor" strokeWidth="2" fill="none" />
      </svg>
    </div>
  );
}

/* ────────────────────────── 1. Architecture ────────────────────────── */

export function Slide1({ editing }: SlideProps) {
  return (
    <SlideCanvas>
      <SlideHeader
        titleId="s1.title" titleDefault="Архитектура верхнего уровня"
        subtitleId="s1.sub" subtitleDefault="Как данные из матчей Apex Legends превращаются в интерактивную аналитику."
        editing={editing}
      />
      <div className="mt-16 grid grid-cols-[1.1fr_auto_1.1fr_auto_1fr_auto_0.9fr_auto_1.1fr] items-center gap-x-6 px-20">
        {/* External sources column */}
        <Block className="row-span-1 p-6">
          <EditableText id="s1.ext.title" defaultValue="ВНЕШНИЕ ИСТОЧНИКИ" editing={editing} as="div"
            className="mb-4 text-center text-[18px] font-bold uppercase tracking-wider text-muted-foreground" />
          <div className="mx-auto h-0.5 w-12 bg-primary" />
          <div className="mt-6 space-y-5">
            <Block className="p-5">
              <div className="flex flex-col items-center gap-3">
                <IconBubble Icon={FolderOpen} color="primary" />
                <EditableText id="s1.vod" defaultValue="VOD / записи матчей" editing={editing}
                  className="text-center text-[22px] font-semibold" multiline />
              </div>
            </Block>
            <Block className="p-5">
              <div className="flex flex-col items-center gap-3">
                <IconBubble Icon={FileText} color="primary" />
                <EditableText id="s1.meta" defaultValue="Метаданные турниров" editing={editing}
                  className="text-center text-[22px] font-semibold" multiline />
              </div>
            </Block>
          </div>
        </Block>
        <Arrow />
        <div className="flex flex-col gap-8">
          <NodeCard id="s1.collect" Icon={CloudUpload} title="Сервис сбора данных"
            desc="Импорт матчей, видео и структуры турнира" editing={editing} />
          <NodeCard id="s1.analyze" Icon={BrainCircuit} title="Сервис анализа"
            desc="Компьютерное зрение, трекинг команд и анализ зон" editing={editing} />
        </div>
        <Arrow />
        <NodeCard id="s1.db" Icon={Database} title="PostgreSQL"
          desc="Единый источник структурированных данных" editing={editing} />
        <Arrow />
        <NodeCard id="s1.api" Icon={Code2} title="API" desc="Доступ к данным и задачам" editing={editing} />
        <Arrow />
        <div className="flex flex-col gap-6">
          <NodeCard id="s1.web" Icon={Monitor} title="Веб-интерфейс"
            desc="Интерактивная карта, таймлайн и фильтры" editing={editing} />
          <div className="flex justify-center"><Arrow dir="down" /></div>
          <NodeCard id="s1.user" Icon={User} title="Аналитик / тренер" desc="" editing={editing} compact />
        </div>
      </div>
    </SlideCanvas>
  );
}

function NodeCard({
  id, Icon, title, desc, editing, compact = false, color = "cyan",
}: {
  id: string; Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string; desc: string; editing: boolean; compact?: boolean;
  color?: "cyan" | "primary";
}) {
  return (
    <Block className={compact ? "p-5" : "p-7"}>
      <div className="flex flex-col items-center gap-3">
        <IconBubble Icon={Icon} color={color} />
        <EditableText id={id + ".t"} defaultValue={title} editing={editing}
          className="text-center text-[24px] font-bold" multiline />
        {desc !== "" && (
          <EditableText id={id + ".d"} defaultValue={desc} editing={editing}
            className="text-center text-[18px] leading-snug text-muted-foreground" multiline />
        )}
      </div>
    </Block>
  );
}

/* ────────────────────────── 2. Data flow ────────────────────────── */

export function Slide2({ editing }: SlideProps) {
  return (
    <SlideCanvas>
      <SlideHeader
        titleId="s2.title" titleDefault="Диаграмма потока данных"
        subtitleId="s2.sub" subtitleDefault="Как видеоданные проходят путь от VOD до интерактивной аналитики Apex Legends."
        editing={editing}
      />
      <div className="mt-14 grid grid-cols-[1.1fr_auto_0.95fr_auto_0.95fr_auto_1.1fr_auto_1fr_auto_1fr_auto_1fr] items-center gap-x-3 px-16">
        <Block className="p-5">
          <EditableText id="s2.src.title" defaultValue="ИСХОДНЫЕ ДАННЫЕ" editing={editing}
            className="mb-4 text-center text-[16px] font-bold uppercase tracking-wider text-muted-foreground" />
          <div className="mx-auto h-0.5 w-12 bg-primary" />
          <div className="mt-5 space-y-4">
            {[
              { id: "s2.vod", Icon: FolderOpen, label: "VOD / запись матча" },
              { id: "s2.meta", Icon: FileText, label: "Метаданные матча" },
              { id: "s2.map", Icon: MapIcon, label: "Карта / ассеты" },
            ].map((it) => (
              <Block key={it.id} className="p-4">
                <div className="flex flex-col items-center gap-2">
                  <it.Icon className="h-10 w-10 text-primary" strokeWidth={1.6} />
                  <EditableText id={it.id} defaultValue={it.label} editing={editing}
                    className="text-center text-[18px] font-semibold" multiline />
                </div>
              </Block>
            ))}
          </div>
        </Block>
        <Arrow />
        <NodeCard id="s2.collect" Icon={CloudUpload} title="Сбор данных" desc="Импорт матчей, VOD и метаданных" editing={editing} />
        <Arrow />
        <NodeCard id="s2.pre" Icon={Sliders} title="Предобработка" desc="Валидация, разметка и подготовка файлов" editing={editing} />
        <Arrow />
        <Block className="p-5">
          <EditableText id="s2.cv.title" defaultValue="CV-анализ" editing={editing}
            className="mb-3 text-center text-[20px] font-bold text-cyan" />
          <div className="mx-auto h-0.5 w-10 bg-primary" />
          <div className="mt-4 space-y-3">
            {[
              { id: "s2.start", Icon: Flag, label: "Старт карты" },
              { id: "s2.ring", Icon: Target, label: "Кольца" },
              { id: "s2.gaze", Icon: Eye, label: "Трекинг обзора" },
              { id: "s2.team", Icon: Users, label: "Трекинг команд" },
            ].map((it) => (
              <div key={it.id} className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/60 px-3 py-2">
                <it.Icon className="h-5 w-5 text-cyan" strokeWidth={1.8} />
                <EditableText id={it.id} defaultValue={it.label} editing={editing} className="text-[18px]" />
              </div>
            ))}
          </div>
          <EditableText id="s2.cv.foot" defaultValue="Извлечение игровых событий и координат" editing={editing}
            className="mt-4 text-center text-[14px] text-muted-foreground" multiline />
        </Block>
        <Arrow />
        <NodeCard id="s2.struct" Icon={Database} title="Структурированные данные" desc="Позиции, события, зоны, статистика" editing={editing} />
        <Arrow />
        <NodeCard id="s2.db" Icon={Database} title="PostgreSQL" desc="Нормализованное хранилище" editing={editing} />
        <Arrow />
        <div className="flex flex-col gap-5">
          <NodeCard id="s2.api" Icon={Code2} title="API" desc="Доступ для клиентов" editing={editing} />
          <NodeCard id="s2.dash" Icon={Monitor} title="Дашборд" desc="Карта, таймлайн и инсайты" editing={editing} />
        </div>
      </div>
    </SlideCanvas>
  );
}

/* ────────────────────────── 3. CV pipeline ────────────────────────── */

export function Slide3({ editing }: SlideProps) {
  const steps = [
    { n: 1, Icon: Play, title: "Видеокадр", caption: "Исходный кадр трансляции" },
    { n: 2, Icon: Crosshair, title: "Миникарта / HUD", caption: "Выделение нужной области" },
    { n: 3, Icon: MapIcon, title: "Регистрация карты", caption: "Привязка к игровой карте" },
    { n: 4, Icon: Target, title: "Детекция кольца", caption: "Поиск текущей зоны" },
    { n: 5, Icon: Users, title: "Детекция маркеров команд", caption: "Поиск игроков и сквадов" },
    { n: 6, Icon: BarChart3, title: "Нормализация координат", caption: "Перевод в единое пространство" },
    { n: 7, Icon: TrendingUp, title: "Трекинг и результат", caption: "Траектории, события и вывод" },
  ];
  const tech = [
    { Icon: Eye, label: "OpenCV" },
    { Icon: Target, label: "Сегментация цвета" },
    { Icon: Crosshair, label: "Шаблонное сопоставление" },
    { Icon: Eye, label: "Детекция объектов" },
    { Icon: TrendingUp, label: "Калман-фильтр" },
    { Icon: Globe, label: "Проекция карты" },
  ];
  return (
    <SlideCanvas>
      <SlideHeader
        titleId="s3.title" titleDefault="Конвейер компьютерного зрения"
        subtitleId="s3.sub" subtitleDefault="Как видеокадр превращается в координаты, игровые события и наглядную аналитику."
        editing={editing}
      />
      <div className="mt-12 grid grid-cols-7 gap-4 px-16">
        {steps.map((s, i) => (
          <div key={s.n} className="relative">
            <div className="absolute -top-4 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-[18px] font-bold text-primary-foreground shadow-lg">
              {s.n}
            </div>
            <Block className="pt-8 pb-5 px-4 h-[420px] flex flex-col">
              <div className="flex flex-col items-center gap-2">
                <s.Icon className="h-14 w-14 text-cyan" strokeWidth={1.6} />
                <EditableText id={`s3.s${i}.t`} defaultValue={s.title} editing={editing}
                  className="text-center text-[18px] font-bold" multiline />
              </div>
              <div className="my-3 flex-1 rounded-md border border-border bg-surface-2/40" />
              <EditableText id={`s3.s${i}.c`} defaultValue={s.caption} editing={editing}
                className="text-center text-[14px] text-muted-foreground" multiline />
            </Block>
          </div>
        ))}
      </div>
      <div className="mt-10 px-16">
        <div className="flex items-center gap-4">
          <div className="h-px flex-1 bg-border" />
          <EditableText id="s3.tech.title" defaultValue="КЛЮЧЕВЫЕ ТЕХНОЛОГИИ" editing={editing}
            className="text-[16px] font-bold uppercase tracking-wider text-primary" />
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="mt-5 grid grid-cols-6 gap-4">
          {tech.map((t, i) => (
            <Block key={i} className="flex items-center gap-3 px-4 py-3">
              <t.Icon className="h-6 w-6 text-cyan" strokeWidth={1.8} />
              <EditableText id={`s3.tech.${i}`} defaultValue={t.label} editing={editing} className="text-[16px] font-semibold" />
            </Block>
          ))}
        </div>
      </div>
    </SlideCanvas>
  );
}

/* ────────────────────────── 4 & 9. User flow ────────────────────────── */

const FLOW_STEPS = [
  { Icon: BarChart3, label: "Открыть дашборд" },
  { Icon: Trophy, label: "Выбрать турнир" },
  { Icon: Swords, label: "Выбрать матч" },
  { Icon: MapIcon, label: "Выбрать карту" },
  { Icon: Filter, label: "Применить фильтры" },
  { Icon: Play, label: "Изучить таймлайн и карту" },
  { Icon: TrendingUp, label: "Получить инсайты" },
];

function FlowStrip({ idPrefix, editing }: { idPrefix: string; editing: boolean }) {
  return (
    <div className="grid grid-cols-[repeat(7,1fr)] items-center gap-3 px-20">
      {FLOW_STEPS.map((s, i) => (
        <div key={i} className="flex items-center">
          <div className="relative flex-1">
            <div className="absolute -top-3 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-[16px] font-bold text-primary-foreground shadow-lg">
              {i + 1}
            </div>
            <Block className="px-4 pt-7 pb-5">
              <div className="flex flex-col items-center gap-2">
                <s.Icon className="h-12 w-12 text-cyan" strokeWidth={1.6} />
                <EditableText id={`${idPrefix}.${i}`} defaultValue={s.label} editing={editing}
                  className="text-center text-[18px] font-semibold leading-tight" multiline />
              </div>
            </Block>
          </div>
          {i < FLOW_STEPS.length - 1 && (
            <div className="px-1 text-muted-foreground">
              <svg width="22" height="14" viewBox="0 0 22 14"><polyline points="0,7 18,7 14,2 18,7 14,12" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function Slide4({ editing }: SlideProps) {
  return (
    <SlideCanvas>
      <SlideHeader
        titleId="s4.title" titleDefault="Пользовательский сценарий"
        subtitleId="s4.sub" subtitleDefault="Как аналитик проходит путь от выбора матча до получения инсайтов."
        editing={editing}
      />
      <div className="mt-14"><FlowStrip idPrefix="s4.flow" editing={editing} /></div>
      <div className="mt-12 px-16">
        <Block className="p-6">
          <div className="mb-4 grid grid-cols-4 gap-4 text-[16px]">
            {[
              ["ТУРНИР", "Летний кубок 2024"],
              ["МАТЧ", "Финал · Матч 3"],
              ["КАРТА", "Шторм-Пойнт"],
              ["ФИЛЬТРЫ", "Все команды"],
            ].map(([k, v], i) => (
              <div key={i} className="rounded-md border border-border bg-surface-2/60 px-3 py-2">
                <div className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">{k}</div>
                <EditableText id={`s4.head.${i}`} defaultValue={v} editing={editing} className="mt-0.5 text-[18px]" />
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[1fr_2.5fr_1.4fr] gap-4">
            <Block className="p-4">
              <div className="mb-3 text-[14px] font-bold uppercase tracking-wider text-muted-foreground">Команды</div>
              {["№1","№5","№8","№12","№17","№20"].map((t, i) => (
                <div key={i} className="mb-2 flex items-center justify-between rounded-md border border-border bg-surface-2/40 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: ["#3b82f6","#a855f7","#ef4444","#f59e0b","#22c55e","#14b8a6"][i] }} />
                    <EditableText id={`s4.team.${i}`} defaultValue={`Команда ${t}`} editing={editing} className="text-[16px]" />
                  </div>
                  <Eye className="h-4 w-4 text-muted-foreground" />
                </div>
              ))}
            </Block>
            <Block className="relative p-0 overflow-hidden h-[440px]">
              <div className="absolute inset-0 hud-grid-bg opacity-40" />
              <div className="absolute left-3 top-3 rounded-md bg-surface/80 px-3 py-1 text-[14px] font-mono">08:37 · Раунд 1</div>
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                <div className="h-72 w-72 rounded-full border-2 border-dashed border-cyan/60" />
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex items-center gap-3 text-[14px]">
                <Play className="h-5 w-5 text-primary" />
                <span className="font-mono">00:00</span>
                <div className="relative h-1 flex-1 rounded-full bg-border">
                  <div className="absolute left-[40%] -top-1 h-3 w-3 rounded-full bg-primary" />
                </div>
                <span className="font-mono">20:00</span>
              </div>
            </Block>
            <Block className="p-4">
              <div className="mb-3 text-[14px] font-bold uppercase tracking-wider text-muted-foreground">Общая статистика</div>
              <div className="mb-3 grid grid-cols-4 gap-2 text-center">
                {[["20","Команд"],["6","Раундов"],["20:00","Длительность"],["114","Убийств"]].map(([v,k],i)=>(
                  <div key={i} className="rounded-md border border-border bg-surface-2/40 px-2 py-2">
                    <div className="text-[18px] font-bold">{v}</div>
                    <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
                  </div>
                ))}
              </div>
              <div className="text-[14px] font-bold uppercase tracking-wider text-muted-foreground">Лидеры матча</div>
              <div className="mt-2 space-y-1.5 text-[14px]">
                {[["Убийства","Команда №8","27"],["Урон","Команда №1","5 842"],["Расстояние","Команда №17","8.7 км"],["Выживаемость","Команда №5","68%"]].map((r,i)=>(
                  <div key={i} className="flex items-center justify-between rounded-md border border-border bg-surface-2/40 px-2 py-1.5">
                    <span className="text-muted-foreground">{r[0]}</span>
                    <span>{r[1]}</span>
                    <span className="font-mono text-primary">{r[2]}</span>
                  </div>
                ))}
              </div>
            </Block>
          </div>
        </Block>
      </div>
    </SlideCanvas>
  );
}

export function Slide9({ editing }: SlideProps) {
  return (
    <SlideCanvas>
      <SlideHeader
        titleId="s9.title" titleDefault="Пользовательский сценарий — детали"
        subtitleId="s9.sub" subtitleDefault="Подробный разбор интерфейса дашборда аналитика."
        editing={editing}
      />
      <div className="mt-14"><FlowStrip idPrefix="s9.flow" editing={editing} /></div>
      <div className="mt-10 grid grid-cols-[2.4fr_1fr] gap-5 px-16">
        <Block className="p-5 h-[520px]">
          <div className="mb-4 text-[14px] font-bold uppercase tracking-wider text-muted-foreground">Игровая карта</div>
          <div className="relative h-[440px] rounded-md border border-border bg-surface-2/40 hud-grid-bg">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="h-80 w-80 rounded-full border-2 border-dashed border-cyan/60" />
            </div>
          </div>
        </Block>
        <div className="space-y-4">
          {[
            { Icon: Users, t: "Панель команд", d: "Списки команд слева и справа. Цветовая привязка к маршрутам и текущему состоянию." },
            { Icon: Filter, t: "Фильтры матча", d: "Выбор турнира, матча и карты в боковой панели. Фильтры по командам и фазам." },
            { Icon: MapIcon, t: "Игровая карта", d: "Центральная зона карты с маршрутами команд, кольцом, таймингами и подписями." },
            { Icon: Play, t: "Воспроизведение", d: "Нижняя шкала времени для навигации по раундам и ключевым событиям." },
            { Icon: Clock, t: "Таймер раунда", d: "Верхний индикатор показывает текущую фазу и оставшееся время." },
          ].map((b, i) => (
            <Block key={i} className="p-4">
              <div className="flex gap-3">
                <b.Icon className="h-8 w-8 shrink-0 text-cyan" strokeWidth={1.6} />
                <div>
                  <EditableText id={`s9.b.${i}.t`} defaultValue={b.t} editing={editing}
                    className="text-[20px] font-bold text-primary" />
                  <EditableText id={`s9.b.${i}.d`} defaultValue={b.d} editing={editing}
                    className="mt-1 text-[14px] text-muted-foreground" multiline />
                </div>
              </div>
            </Block>
          ))}
        </div>
      </div>
    </SlideCanvas>
  );
}

/* ────────────────────────── 5. Domain model ────────────────────────── */

function EntityCard({
  id, Icon, title, fields, editing, color = "primary",
}: {
  id: string; Icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string; fields: string[]; editing: boolean;
  color?: "primary" | "cyan" | "success" | "warning";
}) {
  const ring: Record<string, string> = {
    primary: "border-primary/50", cyan: "border-cyan/50",
    success: "border-success/50", warning: "border-warning/50",
  };
  return (
    <div className={"rounded-2xl border-2 bg-surface/60 p-5 " + ring[color]}>
      <div className="mb-3 flex items-center gap-3">
        <Icon className="h-8 w-8 text-cyan" strokeWidth={1.6} />
        <EditableText id={id + ".t"} defaultValue={title} editing={editing}
          className="text-[22px] font-bold" />
      </div>
      <div className="h-0.5 w-12 bg-primary" />
      <ul className="mt-3 space-y-1.5 text-[16px]">
        {fields.map((f, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
            <EditableText id={`${id}.f.${i}`} defaultValue={f} editing={editing} className="font-mono" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Slide5({ editing }: SlideProps) {
  return (
    <SlideCanvas>
      <SlideHeader
        titleId="s5.title" titleDefault="Предметная модель"
        subtitleId="s5.sub" subtitleDefault="Ключевые сущности и связи внутри системы аналитики матчей Apex Legends."
        editing={editing}
      />
      <div className="mt-10 grid grid-cols-4 gap-6 px-16">
        <EntityCard id="s5.tour" Icon={Trophy} title="Турнир" fields={["id","название","сезон","год"]} editing={editing} color="primary" />
        <EntityCard id="s5.match" Icon={Swords} title="Матч" fields={["id","время_старта","тип","best_of"]} editing={editing} color="primary" />
        <EntityCard id="s5.map" Icon={MapIcon} title="Карта" fields={["id","название","порядок","длительность"]} editing={editing} color="cyan" />
        <EntityCard id="s5.evt" Icon={Play} title="Событие таймлайна" fields={["id","тип","метка_времени","данные"]} editing={editing} color="primary" />

        <EntityCard id="s5.team" Icon={Users} title="Команда" fields={["id","название","тег","регион"]} editing={editing} color="primary" />
        <EntityCard id="s5.player" Icon={User} title="Игрок" fields={["id","имя","роль","team_id"]} editing={editing} color="primary" />
        <EntityCard id="s5.pos" Icon={MapIcon} title="Позиция команды" fields={["id","map_id","team_id","метка_времени","позиция"]} editing={editing} color="success" />
        <EntityCard id="s5.ring" Icon={Target} title="Кольцо" fields={["id","map_id","номер_кольца","полигон","timestamp"]} editing={editing} color="primary" />
      </div>
      <div className="mt-10 mx-16 rounded-xl border border-border bg-surface/40 p-4">
        <div className="grid grid-cols-5 gap-4 text-[14px] text-muted-foreground">
          {[
            ["primary","Основные сущности (соревновательный контекст)"],
            ["cyan","Игровой контент (карта)"],
            ["success","Аналитические сущности (позиции)"],
            ["primary","Аналитические сущности (события)"],
            ["","Связь 1:N — стрелка"],
          ].map(([c,l],i)=>(
            <div key={i} className="flex items-center gap-2">
              {c && <span className={"h-3 w-3 rounded-sm " + (c==="cyan"?"bg-cyan":c==="success"?"bg-success":"bg-primary")} />}
              <span>{l}</span>
            </div>
          ))}
        </div>
      </div>
    </SlideCanvas>
  );
}

/* ────────────────────────── 6. ER diagram ────────────────────────── */

function ErTable({
  id, title, rows, editing,
}: { id: string; title: string; rows: [string,string,string][]; editing: boolean }) {
  return (
    <div className="rounded-xl border border-cyan/40 bg-surface/60 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Database className="h-5 w-5 text-cyan" strokeWidth={1.8} />
        <EditableText id={id + ".t"} defaultValue={title} editing={editing} className="text-[20px] font-bold" />
      </div>
      <div className="h-px w-full bg-border" />
      <table className="mt-2 w-full text-[14px] font-mono">
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/40 last:border-0">
              <td className="py-1.5 pr-2">
                {r[0] && (
                  <span className={"rounded px-1.5 py-0.5 text-[11px] font-bold " + (r[0]==="PK"?"bg-cyan/20 text-cyan":"bg-muted text-muted-foreground")}>
                    {r[0]}
                  </span>
                )}
              </td>
              <td className="py-1.5"><EditableText id={`${id}.r${i}.n`} defaultValue={r[1]} editing={editing} /></td>
              <td className="py-1.5 text-right text-muted-foreground"><EditableText id={`${id}.r${i}.t`} defaultValue={r[2]} editing={editing} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Slide6({ editing }: SlideProps) {
  return (
    <SlideCanvas>
      <SlideHeader
        titleId="s6.title" titleDefault="ER-диаграмма базы данных"
        subtitleId="s6.sub" subtitleDefault="Упрощённая структура таблиц и связей для хранения аналитики матчей."
        editing={editing}
      />
      <div className="mt-10 grid grid-cols-5 gap-4 px-12">
        <ErTable id="s6.tour" title="tournaments" editing={editing} rows={[
          ["PK","id","integer"],["","name","text"],["","game","text"],["","start_date","timestamp"],["","end_date","timestamp"],
        ]} />
        <ErTable id="s6.match" title="matches" editing={editing} rows={[
          ["PK","id","integer"],["FK","tournament_id","integer"],["","name","text"],["","start_time","timestamp"],["","status","text"],
        ]} />
        <ErTable id="s6.maps" title="maps" editing={editing} rows={[
          ["PK","id","integer"],["FK","match_id","integer"],["","name","text"],["","order_index","integer"],["","map_type","text"],
        ]} />
        <ErTable id="s6.teams" title="teams" editing={editing} rows={[
          ["PK","id","integer"],["FK","tournament_id","integer"],["","name","text"],["","tag","text"],["","region","text"],
        ]} />
        <ErTable id="s6.players" title="players" editing={editing} rows={[
          ["PK","id","integer"],["FK","team_id","integer"],["","nick","text"],["","role","text"],["","nationality","text"],
        ]} />
      </div>
      <div className="mt-6 grid grid-cols-5 gap-4 px-12">
        <ErTable id="s6.rings" title="rings" editing={editing} rows={[
          ["PK","id","integer"],["FK","map_id","integer"],["","ring_number","integer"],["","start_time","timestamp"],["","end_time","timestamp"],
        ]} />
        <ErTable id="s6.pos" title="team_positions" editing={editing} rows={[
          ["PK","id","integer"],["FK","map_id","integer"],["FK","team_id","integer"],["FK","ring_id","integer"],["","position","text"],
        ]} />
        <ErTable id="s6.evt" title="timeline_events" editing={editing} rows={[
          ["PK","id","integer"],["FK","map_id","integer"],["FK","team_id","integer"],["","event_type","text"],["","event_time","timestamp"],
        ]} />
        <ErTable id="s6.jobs" title="analysis_jobs" editing={editing} rows={[
          ["PK","id","integer"],["FK","map_id","integer"],["","job_type","text"],["","status","text"],["","created_at","timestamp"],
        ]} />
        <ErTable id="s6.out" title="analysis_outputs" editing={editing} rows={[
          ["PK","id","integer"],["FK","job_id","integer"],["","output_type","text"],["","file_url","text"],["","created_at","timestamp"],
        ]} />
      </div>
      <div className="mt-8 flex items-center justify-center gap-6 text-[16px] text-muted-foreground">
        <div className="flex items-center gap-2"><span className="rounded bg-cyan/20 px-2 py-0.5 text-[12px] font-bold text-cyan">PK</span> Primary Key</div>
        <div className="flex items-center gap-2"><span className="rounded bg-muted px-2 py-0.5 text-[12px] font-bold text-muted-foreground">FK</span> Foreign Key</div>
      </div>
    </SlideCanvas>
  );
}

/* ────────────────────────── 7. Manual vs Auto ────────────────────────── */

export function Slide7({ editing }: SlideProps) {
  const manual = ["Смотреть весь VOD","Делать заметки","Сохранять скриншоты","Ручная разметка карты","Сложно сравнивать","Тратится много времени"];
  const auto = ["Автоматический детект","Визуальный таймлайн","Треки команд на карте","Быстрые сравнения","Экспорт данных","Экономия времени"];
  return (
    <SlideCanvas>
      <SlideHeader
        titleId="s7.title" titleDefault="Ручной vs Автоматизированный анализ"
        subtitleId="s7.sub" subtitleDefault="Сравнение традиционного разбора матча и автоматизированного подхода Apex Stats."
        editing={editing}
      />
      <div className="relative mt-10 grid grid-cols-2 gap-6 px-16">
        <div className="rounded-2xl border-2 border-destructive/50 bg-surface/60 p-6">
          <div className="mb-4 flex items-center gap-3">
            <User className="h-9 w-9 text-destructive" strokeWidth={1.6} />
            <EditableText id="s7.m.t" defaultValue="Ручной анализ (традиционно)" editing={editing}
              className="text-[26px] font-bold text-destructive" />
          </div>
          <div className="grid grid-cols-[1fr_1.1fr] gap-5">
            <div className="h-64 rounded-lg border border-border bg-surface-2/40 hud-grid-bg" />
            <ul className="space-y-3">
              {manual.map((m, i) => (
                <li key={i} className="flex items-center gap-2 text-[18px]">
                  <X className="h-5 w-5 text-destructive" />
                  <EditableText id={`s7.m.${i}`} defaultValue={m} editing={editing} />
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-6 flex items-center gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-5 py-3">
            <Clock className="h-8 w-8 text-destructive" />
            <EditableText id="s7.m.time" defaultValue="3–6 часов" editing={editing}
              className="text-[36px] font-extrabold text-destructive" />
          </div>
        </div>
        <div className="rounded-2xl border-2 border-success/50 bg-surface/60 p-6">
          <div className="mb-4 flex items-center gap-3">
            <Bot className="h-9 w-9 text-success" strokeWidth={1.6} />
            <EditableText id="s7.a.t" defaultValue="Apex Stats (автоматизировано)" editing={editing}
              className="text-[26px] font-bold text-success" />
          </div>
          <div className="grid grid-cols-[1.1fr_1fr] gap-5">
            <div className="h-64 rounded-lg border border-border bg-surface-2/40 hud-grid-bg" />
            <ul className="space-y-3">
              {auto.map((a, i) => (
                <li key={i} className="flex items-center gap-2 text-[18px]">
                  <Check className="h-5 w-5 text-success" />
                  <EditableText id={`s7.a.${i}`} defaultValue={a} editing={editing} />
                </li>
              ))}
            </ul>
          </div>
          <div className="mt-6 grid grid-cols-[1fr_1fr] gap-3">
            <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3">
              <Clock className="h-7 w-7 text-success" />
              <EditableText id="s7.a.time" defaultValue="20–30 минут" editing={editing}
                className="text-[28px] font-extrabold text-success" />
            </div>
            <div className="flex items-center gap-3 rounded-xl border border-success/40 bg-success/10 px-4 py-3">
              <Rocket className="h-7 w-7 text-success" />
              <EditableText id="s7.a.save" defaultValue="Экономия 80–90% времени" editing={editing}
                className="text-[18px] font-bold text-success" multiline />
            </div>
          </div>
        </div>
        <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex h-20 w-20 items-center justify-center rounded-full border-2 border-primary bg-background text-[24px] font-extrabold text-primary">VS</div>
        </div>
      </div>
    </SlideCanvas>
  );
}

/* ────────────────────────── 8. Tech stack ────────────────────────── */

export function Slide8({ editing }: SlideProps) {
  const cols = [
    { title: "Frontend", Icon: Monitor, items: ["Next.js","React","TypeScript","Tailwind CSS"] },
    { title: "Backend API", Icon: Server, items: ["NestJS","TypeScript","REST API","WebSocket"] },
    { title: "Сбор данных", Icon: CloudUpload, items: ["Node.js","TypeScript","Scheduler","BullMQ"] },
    { title: "Анализ (CV)", Icon: Eye, items: ["Python","OpenCV","NumPy","YOLO"] },
    { title: "База данных", Icon: Database, items: ["PostgreSQL","PostGIS","Prisma ORM"] },
    { title: "Инфраструктура", Icon: Server, items: ["Docker","Nginx","PM2","Ubuntu"] },
  ];
  const common = [
    { Icon: ShieldCheck, label: "Zod (Validation)" },
    { Icon: Code2, label: "TypeScript Types" },
    { Icon: Code2, label: "ESLint / Prettier" },
    { Icon: GitBranch, label: "GitHub Actions (CI/CD)" },
  ];
  return (
    <SlideCanvas>
      <SlideHeader
        titleId="s8.title" titleDefault="Технологический стек"
        subtitleId="s8.sub" subtitleDefault="Ключевые технологии и инструменты, на которых построена платформа Apex Stats."
        editing={editing}
      />
      <div className="mt-12 grid grid-cols-6 gap-4 px-16">
        {cols.map((c, i) => (
          <div key={i} className="relative">
            <div className="absolute -top-4 left-1/2 z-10 flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-primary text-[18px] font-bold text-primary-foreground shadow-lg">
              {i + 1}
            </div>
            <Block className="pt-9 pb-5 px-4">
              <div className="flex flex-col items-center gap-2">
                <c.Icon className="h-14 w-14 text-cyan" strokeWidth={1.4} />
                <EditableText id={`s8.col.${i}.t`} defaultValue={c.title} editing={editing}
                  className="text-[22px] font-bold" />
              </div>
              <div className="my-4 h-px w-full bg-border" />
              <ul className="space-y-2.5">
                {c.items.map((it, j) => (
                  <li key={j} className="flex items-center gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[16px]">
                    <span className="h-2 w-2 rounded-full bg-cyan" />
                    <EditableText id={`s8.col.${i}.i.${j}`} defaultValue={it} editing={editing} />
                  </li>
                ))}
              </ul>
            </Block>
          </div>
        ))}
      </div>
      <div className="mt-10 px-16">
        <div className="flex items-center gap-4">
          <div className="h-px flex-1 bg-border" />
          <EditableText id="s8.common.t" defaultValue="ОБЩИЕ КОМПОНЕНТЫ" editing={editing}
            className="text-[16px] font-bold uppercase tracking-wider text-primary" />
          <div className="h-px flex-1 bg-border" />
        </div>
        <div className="mt-5 grid grid-cols-4 gap-4">
          {common.map((t, i) => (
            <Block key={i} className="flex items-center gap-3 px-4 py-3">
              <t.Icon className="h-7 w-7 text-cyan" strokeWidth={1.6} />
              <EditableText id={`s8.common.${i}`} defaultValue={t.label} editing={editing} className="text-[18px] font-semibold" />
            </Block>
          ))}
        </div>
      </div>
    </SlideCanvas>
  );
}

/* ────────────────────────── Slide registry ────────────────────────── */

export type SlideDef = { id: string; title: string; subtitle: string; Component: (p: SlideProps) => ReactElement };

export const SLIDES: SlideDef[] = [
  { id: "01", title: "Архитектура верхнего уровня", subtitle: "Как данные из матчей превращаются в аналитику.", Component: Slide1 },
  { id: "02", title: "Диаграмма потока данных", subtitle: "Путь видеоданных от VOD до интерактивной аналитики.", Component: Slide2 },
  { id: "03", title: "Конвейер компьютерного зрения", subtitle: "Как видеокадр превращается в координаты.", Component: Slide3 },
  { id: "04", title: "Пользовательский сценарий", subtitle: "От выбора матча до получения инсайтов.", Component: Slide4 },
  { id: "05", title: "Предметная модель", subtitle: "Ключевые сущности и связи внутри системы.", Component: Slide5 },
  { id: "06", title: "ER-диаграмма базы данных", subtitle: "Упрощённая структура таблиц и связей.", Component: Slide6 },
  { id: "07", title: "Ручной vs автоматизированный анализ", subtitle: "Сравнение разбора матча.", Component: Slide7 },
  { id: "08", title: "Технологический стек", subtitle: "Ключевые технологии платформы.", Component: Slide8 },
  { id: "09", title: "Пользовательский сценарий — детали", subtitle: "Подробный разбор дашборда аналитика.", Component: Slide9 },
  { id: "10", title: "HSV — калибровка цвета команд", subtitle: "Пипетка и бинарная HSV-маска.", Component: Slide10 },
  { id: "11", title: "ZONES — зоны HUD", subtitle: "Быстрая разметка зон интерфейса трансляции.", Component: Slide11 },
  { id: "12", title: "CAMERA — калибровка камеры", subtitle: "Сравнение сайта, видеопотока и графиков скачков.", Component: Slide12 },
];