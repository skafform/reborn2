import { useState } from "react";
import { FIELD_TYPES } from "../lib/content-type-body";
import { Button, Field } from "./controls";

/**
 * Le formulaire d'un schéma : un nom, un libellé, et des lignes de champ.
 *
 * ⚠️ **Extrait au deuxième consommateur**, pas avant : un type de contenu et
 * une entrée de bibliothèque ont la même forme parce qu'ils envoient le même
 * `SchemaInput`. Le jour où les deux divergeront, c'est ici que ça se verra —
 * et ce sera le signal de les séparer à nouveau.
 *
 * Le corps envoyé est assemblé par `contentTypeBody`, qui lit les trois listes
 * parallèles que ce formulaire produit.
 */
export function SchemaFields() {
  /** Le nombre de lignes de champ offertes — jamais moins d'une. */
  const [rows, setRows] = useState(1);

  return (
    <>
      <Field label="Name">
        {/* ⚠️ Pas de contrainte recopiée ici : le serveur porte l'expression
            régulière, et la console affiche son refus. */}
        <input className="console-input" name="name" required />
      </Field>

      <Field label="Label">
        <input className="console-input" name="label" />
      </Field>

      <p className="console-muted">
        Fields, in the order they appear. That order is the form layout, so changing it
        changes the schema.
      </p>

      {Array.from({ length: rows }, (_, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: la position **est** l'identité d'une ligne ici — c'est elle que le serveur reçoit comme ordre des champs.
        <div className="console-field-row" key={index}>
          <input
            className="console-input"
            name="fieldName"
            placeholder="title"
            aria-label="Field name"
          />
          <select className="console-input" name="fieldType" aria-label="Field type">
            {FIELD_TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
          <label className="console-checkbox">
            <input type="checkbox" name="fieldRequired" value={String(index)} />
            Required
          </label>
        </div>
      ))}

      <Button type="button" onClick={() => setRows((count) => count + 1)}>
        + Add a field
      </Button>
    </>
  );
}
