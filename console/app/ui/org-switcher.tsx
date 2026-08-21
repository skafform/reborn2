import { useEffect, useRef, useState } from "react";

/**
 * Le menu des organizations, en haut à gauche, collé à la marque.
 *
 * Sa place dit sa nature : l'organization encadre tout ce qui est en dessous
 * plutôt que d'être un réglage qu'on irait chercher. Basculer ici remplace la
 * page entière.
 *
 * Purement présentationnel : il reçoit une liste et deux rappels, et ignore
 * comment une organization se charge comme ce que la sélection navigue.
 */
export type SwitcherOrganization = { id: string; name: string };

export function OrgSwitcher({
  organizations,
  currentId,
  onSelect,
  onCreate,
}: {
  organizations: SwitcherOrganization[];
  currentId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    // Un menu qui ne se ferme qu'en choisissant quelque chose est un piège :
    // cliquer à côté et appuyer sur Échap sont les deux façons dont on
    // s'attend à en sortir.
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

  const current = organizations.find((entry) => entry.id === currentId);

  return (
    <div className="console-switcher" ref={container}>
      <button
        type="button"
        className="console-switcher-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{current?.name ?? "Organization"}</span>
        <span aria-hidden="true" className="console-switcher-chevron">
          ⌄
        </span>
      </button>

      {open && (
        <div className="console-menu" role="menu">
          {organizations.map((entry) => (
            <button
              type="button"
              role="menuitem"
              key={entry.id}
              className="console-menu-item"
              onClick={() => {
                setOpen(false);
                onSelect(entry.id);
              }}
            >
              <span>{entry.name}</span>
              {entry.id === currentId && (
                <span aria-hidden="true" className="console-menu-check">
                  ✓
                </span>
              )}
            </button>
          ))}
          <div className="console-menu-separator" />
          <button
            type="button"
            role="menuitem"
            className="console-menu-item"
            onClick={() => {
              setOpen(false);
              onCreate();
            }}
          >
            + New organization
          </button>
        </div>
      )}
    </div>
  );
}
