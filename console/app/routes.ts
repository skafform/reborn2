import { index, layout, type RouteConfig, route } from "@react-router/dev/routes";

/**
 * Les écrans d'entrée vivent hors de toute coque : on n'a pas encore de
 * session, et c'est leur objet. La création d'organization aussi — la coque se
 * construit **autour** d'une organization, et il n'y en a pas encore.
 *
 * Tout le reste vit sous `org/:organizationId`, qui porte la coque et exige la
 * session **une seule fois** pour tous ses écrans.
 */
export default [
  route("signup", "routes/signup.tsx"),
  route("login", "routes/login.tsx"),
  // Les deux moitiés du même geste : demander le lien, puis choisir le mot de
  // passe une fois revenu par le courriel. Le backend y renvoie avec `?token=`
  // ou `?error=INVALID_TOKEN` — l'adresse est donc son `redirectTo`, et ne
  // peut pas changer sans casser les liens déjà envoyés.
  route("reset-password", "routes/reset-password.tsx"),
  // Après l'inscription. Écran d'attente : le compte existe, la confirmation
  // d'adresse est ce qui manque pour s'en servir.
  route("verify-email", "routes/verify-email.tsx"),
  // Le chemin est celui que le backend compose dans l'email
  // (`${PLATFORM_URL}/invitations/accept?token=…`, invitations.ts) — il ne
  // peut pas bouger sans casser les liens déjà envoyés.
  route("invitations/accept", "routes/accept-invitation.tsx"),

  // Ne s'affiche jamais : oriente vers une organization, en créant celle par
  // défaut s'il n'y en a aucune.
  index("routes/home.tsx"),
  route("new-organization", "routes/new-organization.tsx"),

  /**
   * `organization.tsx` ne porte que la barre du haut. La barre latérale est
   * **contextuelle** : entrer dans un projet la remplace entièrement. D'où deux
   * mises en page sœurs sous la même coque, chacune chargeant ce dont la sienne
   * a besoin — plutôt qu'un parent qui devrait lire l'état de son enfant pour
   * savoir quoi afficher.
   */
  route("org/:organizationId", "routes/organization.tsx", [
    layout("routes/organization-sections.tsx", [
      index("routes/projects.tsx"),
      // ⚠️ L'Inbox vit sous une organization pour tenir dans la coque, mais son
      // contenu ne lui appartient pas : ce sont les invitations reçues par la
      // personne, souvent d'organizations tierces. Basculer d'organization
      // affiche donc la même liste — le backend n'attend aucun `organizationId`
      // pour cette route.
      route("inbox", "routes/inbox.tsx"),
      route("team", "routes/team.tsx"),
      route("roles", "routes/roles.tsx"),
      route("settings", "routes/organization-settings.tsx"),
      // ⚠️ Le compte n'appartient à aucune organization — même compromis que
      // l'Inbox, et pour la même raison : la coque vit sous `org/:id`. D'où
      // **aucune entrée dans la barre latérale** : on y arrive par l'avatar, ce
      // qui dit que ce n'est pas une section de l'organization et laisse
      // l'identifiant n'être que de la plomberie.
      route("account", "routes/account.tsx"),
    ]),

    route("projects/:projectId", "routes/project.tsx", [
      index("routes/project-overview.tsx"),
      route("team", "routes/project-team.tsx"),
      route("content-types", "routes/project-content-types.tsx"),
      route("api-keys", "routes/project-api-keys.tsx"),
      route("settings", "routes/project-settings.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
