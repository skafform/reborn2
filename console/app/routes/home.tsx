import { redirect } from "react-router";
import { api, postJson } from "../lib/api";
import { CreatedOrganizationSchema, OrganizationsSchema } from "../lib/api-contract";
import { authClient } from "../lib/auth";

/**
 * La racine ne s'affiche jamais : elle oriente.
 *
 * Un compte sans organization en reçoit une, silencieusement, à sa première
 * arrivée ici — jamais un écran, jamais un bouton à presser. Se connecter ne
 * doit rien demander, y compris à quelqu'un qui arrive par une invitation :
 * son espace personnel et l'invitation qu'il a reçue coexistent, l'une ne
 * remplace pas l'autre. L'invitation l'attend dans son Inbox, à l'intérieur
 * de son espace.
 *
 * Le nom est personnalisé à partir du compte (« X's organization »), pas un
 * littéral générique (« My org ») : ce nom reste visible par qui serait
 * invité ensuite, et aucun écran ne permet encore de le changer.
 */
export async function clientLoader() {
  const { data: session } = await authClient.getSession();
  if (!session) throw redirect("/login");

  const organizations = await api("/organizations", OrganizationsSchema);
  const first = organizations[0];
  // Aucune mémoire de la « dernière visitée » : un état de plus à tenir pour
  // un gain nul tant que le sélecteur suffit à naviguer entre plusieurs
  // organizations une fois dans la coque.
  if (first) throw redirect(`/org/${first.id}`);

  const created = await postJson("/organizations", CreatedOrganizationSchema, {
    name: `${session.user.name}'s organization`,
  });
  throw redirect(`/org/${created.id}`);
}

// La route ne rend rien : son chargeur redirige toujours. React Router exige
// néanmoins un composant.
export default function Home() {
  return null;
}
