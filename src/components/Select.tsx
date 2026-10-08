// A Keel dropdown instead of <select>: the native control's open list is drawn by the
// platform (GTK on Linux: white with a blue highlight) and no CSS reaches it, so it broke
// the look. This one is ours on every system and keeps a select's keyboard behaviour:
// Enter/Space/ArrowDown open it, arrows move, Enter/Space pick, Escape/Tab close.

import { KeyboardEvent, useEffect, useId, useRef, useState } from "react";

export interface Option {
  value: string;
  label: string;
}

interface Props {
  name: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}

export default function Select({ name, value, options, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0); // highlighted option while open
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  // A click anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  function show() {
    setActive(Math.max(0, options.indexOf(current)));
    setOpen(true);
  }

  function pick(index: number) {
    onChange(options[index].value);
    setOpen(false);
  }

  function onKey(e: KeyboardEvent) {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (i + step + options.length) % options.length);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape" || e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="select" ref={root}>
      <button
        type="button"
        name={name}
        className="select-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKey}
      >
        {current.label}
      </button>
      {open && (
        <ul className="select-list" role="listbox" id={listId} aria-label={name}>
          {options.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={i === active ? "active" : undefined}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus on the button
                pick(i);
              }}
            >
              {o.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
