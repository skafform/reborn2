import { useOutletContext } from "react-router";
import { Empty } from "../ui/controls";
import type { ProjectContext } from "./project";

/** Une date fixe, jamais celle du navigateur : deux personnes doivent lire la
 *  même chose. */
const day = (iso: string) => new Date(iso).toLocaleDateString("en-CA");

/**
 * L'accueil d'un projet.
 *
 * Il est maigre, et c'est honnête : ce qu'un projet contient — types de
 * contenu, documents — n'existe pas encore (roadmap, étape 6b). Mieux vaut le
 * dire que remplir la page de compteurs à zéro.
 */
export default function ProjectOverview() {
  const { project } = useOutletContext<ProjectContext>();

  return (
    <>
      <div className="console-page-header">
        <h1>{project.name}</h1>
      </div>

      <dl className="console-facts">
        <dt>Created</dt>
        <dd>{day(project.createdAt)}</dd>
        <dt>Environment</dt>
        <dd>master</dd>
      </dl>

      <Empty>
        Content types and documents live here. They're not built yet — this is where
        they'll appear.
      </Empty>
    </>
  );
}
