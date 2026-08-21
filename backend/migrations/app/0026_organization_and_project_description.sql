-- Une description sur les deux tables, et une adresse de facturation sur
-- l'organization.
--
-- ⚠️ **Deux instructions ont été retirées de ce fichier généré** : Drizzle
-- réémettait `suspended_at` sur `organization_members` et `project_members`.
-- La migration 0024 les a ajoutées **à la main**, donc l'instantané de Drizzle
-- ne les connaissait pas — il proposait de les créer une seconde fois.
-- L'instantané de cette migration, lui, les enregistre : la dérive est
-- absorbée ici et ne se reproduira plus.
--
-- `description` est `not null default ''` : « pas de description » et
-- « description vide » diraient la même chose, et le défaut évite un `null` à
-- traiter dans chaque lecture, jusque dans le contrat.
--
-- `billing_address` est nullable, à l'inverse : « pas encore renseignée » n'est
-- pas « effacée ». Un seul champ libre, jamais une adresse structurée — celle
-- qui fait foi appartiendra au prestataire de paiement, avec ses propres
-- champs (architecture/multi-tenant.md).
ALTER TABLE "organizations" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "description" text DEFAULT '' NOT NULL;
