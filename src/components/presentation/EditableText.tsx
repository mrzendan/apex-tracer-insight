import { useEffect, useRef } from "react";
import { setText, useText } from "./store";

type Props = {
  id: string;
  defaultValue: string;
  editing: boolean;
  as?: "div" | "span" | "h1" | "h2" | "h3" | "p";
  className?: string;
  multiline?: boolean;
};

export function EditableText({
  id, defaultValue, editing, as = "div", className, multiline,
}: Props) {
  const value = useText(id, defaultValue);
  const ref = useRef<HTMLElement | null>(null);

  // Keep DOM in sync only when not focused (avoid caret jumps while typing)
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && el.innerText !== value) {
      el.innerText = value;
    }
  }, [value]);

  const Tag = as as any;
  return (
    <Tag
      ref={ref}
      contentEditable={editing}
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={(e: any) => setText(id, e.currentTarget.innerText)}
      onKeyDown={(e: any) => {
        if (!multiline && e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
      }}
      className={
        (className ?? "") +
        (editing
          ? " outline-none ring-1 ring-primary/40 rounded-sm px-0.5 -mx-0.5 hover:ring-primary cursor-text"
          : " outline-none")
      }
    >
      {value}
    </Tag>
  );
}