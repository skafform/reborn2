import { index, type RouteConfig, route } from "@react-router/dev/routes";

/**
 * Les trois écrans d'entrée vivent hors de toute session : on n'en a pas
 * encore, et c'est précisément leur objet. L'index, lui, en exige une et
 * renvoie vers la connexion à défaut.
 */
export default [
  route("signup", "routes/signup.tsx"),
  route("login", "routes/login.tsx"),
  // Après l'inscription. Écran d'attente : le compte existe, la confirmation
  // d'adresse est ce qui manque pour s'en servir.
  route("verify-email", "routes/verify-email.tsx"),
  index("routes/home.tsx"),
  // L'organization vit dans le chemin : l'écran survit à un rechargement et
  // voyage dans un lien.
  route("org/:organizationId/invite", "routes/invite.tsx"),
] satisfies RouteConfig;
