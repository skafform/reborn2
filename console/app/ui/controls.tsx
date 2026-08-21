import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef } from "react";

/**
 * Les primitives de la console.
 *
 * Un seul petit fichier, et non un module par composant : cinq composants de
 * dix lignes n'en méritent pas cinq. On les séparera le jour où l'un d'eux
 * prendra une vraie implémentation.
 */

type ButtonVariant = "secondary" | "primary" | "danger";

export function Button({
  variant = "secondary",
  block = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  block?: boolean;
}) {
  return (
    <button
      className={[
        "console-button",
        `console-button--${variant}`,
        block ? "console-button--block" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

/**
 * L'action d'une ligne de tableau : du texte, pas une boîte. Une rangée en
 * porte souvent plusieurs, et autant de rectangles bordés transformerait le
 * tableau en grille de boutons.
 */
export function RowAction({
  danger = false,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      type="submit"
      className={[
        "console-link-button",
        danger ? "console-link-button--danger" : null,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

/**
 * L'action de haut de page — « + New Project ». Même stratégie de couleur que
 * la barre latérale, jamais l'accent, mais sans le soulignement de
 * `RowAction` : ça conviendrait à une phrase, pas à une commande à côté d'un
 * titre.
 */
export function HeaderAction({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={["console-link-button", "console-link-button--plain", className]
        .filter(Boolean)
        .join(" ")}
      {...props}
    />
  );
}

/**
 * Un champ : son intitulé, puis le contrôle.
 *
 * Le `<label>` **enveloppe** le contrôle, ce qui l'associe implicitement — pas
 * besoin de `htmlFor` ni d'`id`, donc pas d'identifiant à inventer et à tenir
 * unique. C'est le seul endroit du fichier où une règle est désactivée, et
 * c'est parce que l'analyse statique ne peut pas voir à travers `children`.
 */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: le contrôle arrive par `children`, à l'intérieur du label — association implicite, valide, mais invisible à l'analyse statique.
    <label className="console-field">
      <span className="console-label">{label}</span>
      {children}
    </label>
  );
}

export function Banner({
  tone = "accent",
  children,
}: {
  tone?: "accent" | "error";
  children: ReactNode;
}) {
  return (
    <p className={`console-banner${tone === "error" ? " console-banner--error" : ""}`}>
      {children}
    </p>
  );
}

/**
 * Un état vide est une phrase qui dit quoi faire ensuite, pas un constat. « Il
 * n'y a rien » n'apprend rien à qui regarde un écran vide.
 */
export function Empty({ children }: { children: ReactNode }) {
  return <p className="console-muted">{children}</p>;
}

/**
 * Une boîte de dialogue, sur `<dialog>` natif plutôt qu'une superposition
 * maison : le piège de focus, la fermeture sur Échap et la sémantique
 * d'accessibilité (`role="dialog"`, `aria-modal`) viennent du navigateur.
 * `OrgSwitcher` refait ce travail à la main pour un menu léger — ici, pour un
 * vrai modal, autant s'appuyer sur ce qui existe déjà.
 *
 * `showModal()`/`close()` sont impératifs : React ne peut pas se contenter de
 * l'attribut `open`, qui n'ouvrirait qu'une boîte sans fond ni piège de
 * focus. D'où l'effet, gardé pour ne jamais rappeler l'une ou l'autre méthode
 * sur un état où le navigateur la refuserait.
 *
 * Se ferme sur Échap sans qu'on ait rien à écrire : c'est l'événement natif
 * `close` du `<dialog>`, dont `onClose` reste le miroir.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog ref={ref} className="console-modal" onClose={onClose}>
      <h2>{title}</h2>
      {children}
    </dialog>
  );
}

/**
 * Une section de page : son titre, ce qu'elle est, puis son contenu.
 *
 * La règle horizontale sépare deux sujets — elle dit que ce qui suit n'est pas
 * la suite de ce qui précède. `first` l'omet, faute de quoi la première
 * section serait séparée du titre de la page.
 */
export function Section({
  title,
  description,
  first = false,
  children,
}: {
  title: string;
  description?: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      {!first && <hr />}
      <section>
        <h3>{title}</h3>
        {description && <p className="console-muted">{description}</p>}
        {children}
      </section>
    </>
  );
}
