import { apiVoid, putJson } from "./api";
import { RoleChangeSchema, SuspensionSchema } from "./api-contract";

/**
 * Retirer, suspendre, réactiver, changer de rôle — les quatre mêmes gestes
 * dans l'équipe d'une organization et dans celle d'un projet. Seule l'adresse
 * de base change.
 *
 * Renvoie `null` si le formulaire ne portait aucun de ces gestes, pour que
 * l'appelant continue son propre traitement.
 */
export async function applyMembershipChange(base: string, form: FormData) {
  const removeId = form.get("remove");
  if (typeof removeId === "string") {
    await apiVoid(`${base}/${removeId}`, { method: "DELETE" });
    return { removed: true } as const;
  }

  // Suspendre et réactiver sont la **même** route : un état, pas deux verbes.
  // C'est ce qui rend l'opération idempotente et évite un « réactiver » qui
  // échouerait sur quelqu'un qui ne l'était pas.
  for (const [field, suspended] of [
    ["suspend", true],
    ["restore", false],
  ] as const) {
    const userId = form.get(field);
    if (typeof userId === "string") {
      await putJson(`${base}/${userId}/suspension`, SuspensionSchema, { suspended });
      return { suspended } as const;
    }
  }

  const roleTarget = form.get("changeRoleFor");
  if (typeof roleTarget === "string") {
    await putJson(`${base}/${roleTarget}/role`, RoleChangeSchema, {
      roleId: String(form.get("roleId")),
    });
    return { roleChanged: true } as const;
  }

  return null;
}
