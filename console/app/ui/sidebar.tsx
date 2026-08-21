import type { ReactNode } from "react";
import { NavLink } from "react-router";

/**
 * La barre latérale, dont le **contenu dépend du contexte** : les sections de
 * l'organization, ou celles du projet dans lequel on est entré. Deux appelants,
 * une seule mise en forme.
 *
 * ⚠️ Ce qui s'y affiche est filtré par permission chez l'appelant. Masquer une
 * entrée est un **confort, jamais le garde-fou** : chaque route reste vérifiée
 * côté serveur, et l'adresse reste tapable.
 */
export type Section = {
  to: string;
  label: string;
  /** `true` pour l'entrée d'index, qui serait sinon active partout en dessous. */
  end: boolean;
};

export function Sidebar({
  sections,
  header,
}: {
  sections: Section[];
  /** Le fil de retour et le nom du projet, quand on est entré dans un. */
  header?: ReactNode;
}) {
  return (
    <nav className="console-sidebar">
      {header}
      <ul>
        {sections.map((section) => (
          <li key={section.to}>
            <NavLink
              to={section.to}
              end={section.end}
              className={({ isActive }) =>
                isActive
                  ? "console-nav-link console-nav-link--active"
                  : "console-nav-link"
              }
            >
              {section.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
