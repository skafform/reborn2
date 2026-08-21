import { type ReactNode, useEffect, useRef, useState } from "react";

/**
 * A menu anchored under its trigger.
 *
 * Extracted the day a second one appeared. What it carries is not the markup
 * but the **two ways out**: a click elsewhere and Escape. A menu that only
 * closes by choosing something is a trap, and that is the logic the second
 * menu would have copied.
 *
 * Hand-rolled rather than built on `<dialog>`, unlike `Modal`: a menu neither
 * traps focus nor dims the page, so the browser has nothing to offer here.
 *
 * `children` is a function so an item can close the menu it belongs to without
 * the state leaking out to every caller.
 */
export function Menu({
  trigger,
  align = "start",
  children,
}: {
  trigger: ReactNode;
  /** Which edge the panel lines up with — one on the right would overflow. */
  align?: "start" | "end";
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (
        event.target instanceof Node &&
        container.current?.contains(event.target) !== true
      ) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="console-menu-anchor" ref={container}>
      <button
        type="button"
        className="console-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
        <span aria-hidden="true" className="console-menu-chevron">
          ⌄
        </span>
      </button>

      {open && (
        <div className={`console-menu console-menu--${align}`} role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

export function MenuItem({
  onClick,
  children,
}: {
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="console-menu-item"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function MenuSeparator() {
  return <div className="console-menu-separator" />;
}
