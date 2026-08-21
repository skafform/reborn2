import { Menu, MenuItem, MenuSeparator } from "./menu";

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
  const current = organizations.find((entry) => entry.id === currentId);

  return (
    <Menu trigger={<span>{current?.name ?? "Organization"}</span>}>
      {(close) => (
        <>
          {organizations.map((entry) => (
            <MenuItem
              key={entry.id}
              onClick={() => {
                close();
                onSelect(entry.id);
              }}
            >
              <span>{entry.name}</span>
              {entry.id === currentId && (
                <span aria-hidden="true" className="console-menu-check">
                  ✓
                </span>
              )}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuItem
            onClick={() => {
              close();
              onCreate();
            }}
          >
            + New organization
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
