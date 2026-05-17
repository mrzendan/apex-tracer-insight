import { useEffect, useRef } from "react";
import { setTextV2, useTextV2 } from "../store-v2";

type Props = {
  id: string;
  defaultValue: string;
  editing: boolean;
  as?: "div" | "span" | "h1" | "h2" | "h3" | "p" | "li";
  className?: string;
  multiline?: boolean;
};

export function E({ id, defaultValue, editing, as = "div", className, multiline }: Props) {
  const value = useTextV2(id, defaultValue);
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && el.innerText !== value) el.innerText = value;
  }, [value]);
  const Tag = as as any;
  return (
    <Tag
      ref={ref}
      contentEditable={editing}
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={(e: any) => setTextV2(id, e.currentTarget.innerText)}
      onKeyDown={(e: any) => { if (!multiline && e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
      className={(className ?? "") + (editing ? " outline-none ring-1 ring-[#d97706]/40 rounded-sm cursor-text" : " outline-none")}
    >
      {value}
    </Tag>
  );
}