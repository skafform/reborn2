import { Form } from "react-router";
import { moment } from "../lib/format";
import { RowAction } from "./controls";

/**
 * La lignée d'un schéma : chaque changement d'état, du plus récent au plus
 * ancien, et de quoi revenir en arrière.
 *
 * ⚠️ **Extrait au deuxième consommateur** — un type de contenu et une entrée de
 * bibliothèque se versionnent par la même machinerie (ADR 0016), donc se lisent
 * de la même façon.
 *
 * ⚠️ **Deux noms de champ font le contrat avec l'écran** : `restore` porte
 * l'empreinte visée, `schemaId` la ligne concernée. Les deux `clientAction` les
 * lisent sous ces noms-là.
 */

type Entry = {
  hash: string;
  action: string;
  createdAt: string;
  actorName: string | null;
  actorEmail: string | null;
  name: string;
  label: string | null;
};

/**
 * ⚠️ **`null` veut dire « compte supprimé »**, pas « personne ». L'identifiant
 * de l'acteur passe à `NULL` quand le compte s'en va, l'histoire lui survivant
 * — laisser une case vide ferait passer ça pour un défaut.
 */
const who = (entry: Entry) => entry.actorName ?? entry.actorEmail ?? "Deleted user";

export function Lineage({
  schemaId,
  currentHash,
  entries,
  canWrite,
  busy,
}: {
  schemaId: string;
  currentHash: string;
  entries: readonly Entry[];
  canWrite: boolean;
  busy: boolean;
}) {
  return (
    <>
      <p className="console-muted">
        Every change of state, newest first. Saving without changing anything records
        nothing — this is a log of states, not of clicks.
      </p>

      <table className="console-table">
        <thead>
          <tr>
            <th>When</th>
            <th>What</th>
            <th>Who</th>
            <th>Named</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={`${entry.hash}-${entry.createdAt}`}>
              <td className="console-muted">{moment(entry.createdAt)}</td>
              <td>{entry.action === "restored" ? "Restored" : "Saved"}</td>
              <td className="console-muted">{who(entry)}</td>
              <td>
                <span className="console-identity">
                  {entry.label ?? entry.name}
                  {entry.label && <code className="console-hint">{entry.name}</code>}
                </span>
              </td>
              <td>
                {entry.hash === currentHash ? (
                  <span className="console-hint">Current</span>
                ) : (
                  canWrite && (
                    <Form method="post">
                      <input type="hidden" name="schemaId" value={schemaId} />
                      <RowAction name="restore" value={entry.hash} disabled={busy}>
                        Restore
                      </RowAction>
                    </Form>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
