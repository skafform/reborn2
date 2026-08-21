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
    ]),

    route("projects/:projectId", "routes/project.tsx", [
      index("routes/project-overview.tsx"),
      route("team", "routes/project-team.tsx"),
      route("api-keys", "routes/project-api-keys.tsx"),
    ]),
  ]),
] satisfies RouteConfig;
