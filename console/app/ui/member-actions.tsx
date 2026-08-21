import { Form } from "react-router";
import { RowAction } from "./controls";

/**
 * Ce qu'on peut faire sur une ligne de membre — les mêmes trois actions dans
 * l'équipe d'une organization et dans celle d'un projet.
 *
 * ⚠️ **`manageable` vient du serveur**, calculé par le garde-fou qui refuserait
 * ensuite. Le déduire ici — « c'est un admin, donc je ne peux pas » —
 * recopierait la matrice RBAC hors de sa source de vérité, et un nom de rôle ne
 * garantit rien puisque les rôles sont personnalisables (ADR 0011).
 *
 * Masquer reste un **confort** : chaque route revérifie.
 */
export function MemberActions({
  member,
  isSelf,
  busy,
  onChangeRole,
}: {
  member: { userId: string; manageable: boolean; suspendedAt: string | null };
  isSelf: boolean;
  busy: boolean;
  onChangeRole: () => void;
}) {
  // Partir ne demande aucune permission — d'où une action offerte même sans
  // `manageable`. Se suspendre soi-même est en revanche refusé par le serveur :
  // on se couperait l'accès sans pouvoir revenir.
  if (isSelf) {
    return (
      <Form method="post" className="console-row-actions">
        <RowAction danger name="remove" value={member.userId} disabled={busy}>
          Leave
        </RowAction>
      </Form>
    );
  }

  if (!member.manageable) return null;

  return (
    <div className="console-row-actions">
      <RowAction type="button" onClick={onChangeRole} disabled={busy}>
        Change role
      </RowAction>
      <Form method="post" className="console-row-actions">
        <RowAction
          name={member.suspendedAt ? "restore" : "suspend"}
          value={member.userId}
          disabled={busy}
        >
          {member.suspendedAt ? "Restore" : "Suspend"}
        </RowAction>
        <RowAction danger name="remove" value={member.userId} disabled={busy}>
          Remove
        </RowAction>
      </Form>
    </div>
  );
}
