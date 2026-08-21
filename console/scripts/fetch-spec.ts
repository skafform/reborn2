/**
 * Récupère le contrat de l'API depuis le serveur en marche.
 *
 * ⚠️ **Par HTTP, jamais par un chemin de fichier vers `backend/`.** C'est ce
 * que la console verrait si le backend tournait sur une autre machine, et
 * c'est ce qui garde les deux projets réellement séparables. Une commodité qui
 * franchirait cette frontière marcherait aujourd'hui et casserait le jour où
 * ils se séparent (voir CLAUDE.md, « Les deux doivent rester agnostiques »).
 *
 * L'adresse vient de `API_PROXY_TARGET`, la même que le proxy de
 * développement — la console ne porte l'adresse du backend nulle part dans son
 * code.
 *
 * Le fichier écrit est **commité**. La génération ne doit donc jamais exiger un
 * backend en marche : ni un clone neuf, ni une CI, ni un déploiement n'en ont
 * un sous la main. Seul `api:sync` en a besoin, et c'est un geste délibéré.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const target = process.env.API_PROXY_TARGET;
if (!target) {
  console.error(
    "API_PROXY_TARGET manquante. Copier .env.example vers .env dans console/.",
  );
  process.exit(1);
}

const url = new URL("/openapi.json", target);

const response = await fetch(url).catch((error: unknown) => {
  console.error(
    `Impossible de joindre ${url}. Le backend est-il démarré ?\n  ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  process.exit(1);
});

if (!response.ok) {
  console.error(`${url} a répondu ${response.status}.`);
  process.exit(1);
}

// Réécrit plutôt que recopié tel quel : une mise en forme stable rend le `diff`
// lisible en revue, et c'est lui qui révèle un changement d'API.
const spec: unknown = await response.json();
const destination = join(import.meta.dirname, "..", "app", "lib", "openapi.json");
writeFileSync(destination, `${JSON.stringify(spec, null, 2)}\n`);

const paths = Object.keys((spec as { paths: Record<string, unknown> }).paths).length;
console.log(`Contrat récupéré depuis ${url} — ${paths} chemins.`);
