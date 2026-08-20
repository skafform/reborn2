/**
 * Composants d'email et layout partagé.
 *
 * Reprend de MJML l'idée qui compte — écrire `button()` plutôt que quinze
 * lignes de table imbriquée — sans sa dépendance : trois gabarits
 * transactionnels ne justifient pas 226 paquets. De React Email, la
 * composition typée et le rendu séparé de l'envoi.
 *
 * Le HTML d'email est resté en 1999 : Outlook rend avec le moteur de Word,
 * les styles doivent être en ligne, et les mises en page passent par des
 * tables. Ces contraintes sont enfermées ici, pas dans les gabarits.
 */

const theme = {
  font: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  text: "#1f2328",
  muted: "#656d76",
  accent: "#1f2328",
  background: "#f6f8fa",
  surface: "#ffffff",
  border: "#d0d7de",
  width: 600,
} as const;

/**
 * Toute valeur venant de l'extérieur traverse cette fonction. L'échappement
 * est fait **par les composants**, jamais par leur appelant : c'est ce qui
 * rend l'oubli impossible plutôt que déconseillé.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Un bloc de contenu déjà rendu et échappé. */
export type Block = { readonly html: string };

const block = (html: string): Block => ({ html });

export function heading(content: string): Block {
  return block(
    `<h1 style="margin:0 0 16px;font-family:${theme.font};font-size:20px;` +
      `line-height:28px;font-weight:600;color:${theme.text};">` +
      `${escapeHtml(content)}</h1>`,
  );
}

export function paragraph(content: string): Block {
  return block(
    `<p style="margin:0 0 16px;font-family:${theme.font};font-size:15px;` +
      `line-height:24px;color:${theme.text};">${escapeHtml(content)}</p>`,
  );
}

export function muted(content: string): Block {
  return block(
    `<p style="margin:0 0 8px;font-family:${theme.font};font-size:13px;` +
      `line-height:20px;color:${theme.muted};">${escapeHtml(content)}</p>`,
  );
}

/**
 * Outlook ignore le `padding` sur les éléments en ligne : un bouton doit être
 * une table. Les coins arrondis y dégradent en angles droits, ce qui est sans
 * conséquence.
 */
export function button(label: string, url: string): Block {
  return block(
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
      `style="margin:0 0 24px;"><tr><td style="background:${theme.accent};` +
      `border-radius:6px;"><a href="${escapeHtml(url)}" ` +
      `style="display:inline-block;padding:12px 24px;font-family:${theme.font};` +
      `font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">` +
      `${escapeHtml(label)}</a></td></tr></table>`,
  );
}

/** Le lien en clair, pour les clients qui n'affichent pas les boutons. */
export function fallbackLink(url: string): Block {
  return block(
    `<p style="margin:0;font-family:${theme.font};font-size:12px;` +
      `line-height:18px;color:${theme.muted};word-break:break-all;">` +
      `Si le bouton ne fonctionne pas, copiez ce lien :<br>` +
      `${escapeHtml(url)}</p>`,
  );
}

/** Assemble les blocs dans une enveloppe compatible avec les clients courants. */
export function layout(blocks: readonly Block[]): string {
  const content = blocks.map((b) => b.html).join("\n");

  return `<!doctype html>
<html lang="fr" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<title></title>
</head>
<body style="margin:0;padding:0;background:${theme.background};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
       style="background:${theme.background};padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="${theme.width}" cellpadding="0" cellspacing="0" border="0"
       style="width:100%;max-width:${theme.width}px;background:${theme.surface};
              border:1px solid ${theme.border};border-radius:8px;">
<tr><td style="padding:32px;">
${content}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
