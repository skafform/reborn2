import { button, fallbackLink, heading, muted, paragraph } from "../render.ts";
import { defineTemplate } from "../template.ts";

export type InvitationProps = {
  organizationName: string;
  inviterName: string;
  acceptUrl: string;
  expiresInDays: number;
};

export const invitationEmail = defineTemplate<InvitationProps>({
  name: "invitation",

  subject: (p) => `${p.inviterName} vous invite à rejoindre ${p.organizationName}`,

  body: (p) => [
    heading(`Rejoindre ${p.organizationName}`),
    paragraph(`${p.inviterName} vous invite à collaborer sur ${p.organizationName}.`),
    button("Accepter l'invitation", p.acceptUrl),
    muted(`Ce lien expire dans ${p.expiresInDays} jours et ne sert qu'une fois.`),
    muted("Si vous n'attendiez pas cette invitation, ignorez ce message."),
    fallbackLink(p.acceptUrl),
  ],

  text: (p) =>
    [
      `${p.inviterName} vous invite à rejoindre ${p.organizationName}.`,
      "",
      `Accepter : ${p.acceptUrl}`,
      "",
      `Ce lien expire dans ${p.expiresInDays} jours et ne sert qu'une fois.`,
      "Si vous n'attendiez pas cette invitation, ignorez ce message.",
    ].join("\n"),

  sample: {
    organizationName: "Acme",
    inviterName: "Alice",
    acceptUrl: "https://example.test/invitations/accept?token=exemple",
    expiresInDays: 7,
  },
});
