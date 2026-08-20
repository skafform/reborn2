import { type Block, layout } from "./render.ts";

/**
 * Un gabarit est une **fonction pure** : il rend, il n'envoie pas. C'est ce
 * qui le rend testable sans double d'envoi, et prévisualisable sans expédier
 * quoi que ce soit (voir la route de prévisualisation, hors production).
 */
export type Template<Props> = {
  readonly name: string;
  readonly subject: (props: Props) => string;
  readonly body: (props: Props) => readonly Block[];
  readonly text: (props: Props) => string;
  /** Données d'exemple, pour la prévisualisation et les tests. */
  readonly sample: Props;
};

export type Rendered = { subject: string; html: string; text: string };

export function defineTemplate<Props>(template: Template<Props>): Template<Props> {
  return template;
}

export function render<Props>(template: Template<Props>, props: Props): Rendered {
  return {
    subject: template.subject(props),
    html: layout(template.body(props)),
    // Toujours fourni : les filtres antispam pénalisent le HTML seul, et
    // certains clients n'affichent que le texte.
    text: template.text(props),
  };
}
