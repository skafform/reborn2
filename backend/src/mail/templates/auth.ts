import { button, fallbackLink, heading, muted, paragraph } from "../render.ts";
import { defineTemplate } from "../template.ts";

export type VerifyEmailProps = { verifyUrl: string };

export const verifyEmail = defineTemplate<VerifyEmailProps>({
  name: "verify-email",

  subject: () => "Confirmez votre adresse email",

  body: (p) => [
    heading("Confirmez votre adresse"),
    paragraph("Cliquez pour confirmer cette adresse et activer votre compte."),
    button("Confirmer mon adresse", p.verifyUrl),
    muted(
      "Si vous n'avez pas créé de compte, ignorez ce message : aucun compte ne sera activé.",
    ),
    fallbackLink(p.verifyUrl),
  ],

  text: (p) =>
    [
      "Confirmez votre adresse email pour activer votre compte.",
      "",
      `Confirmer : ${p.verifyUrl}`,
      "",
      "Si vous n'avez pas créé de compte, ignorez ce message :",
      "aucun compte ne sera activé.",
    ].join("\n"),

  sample: { verifyUrl: "https://example.test/verify?token=exemple" },
});

export type ResetPasswordProps = { resetUrl: string };

export const resetPasswordEmail = defineTemplate<ResetPasswordProps>({
  name: "reset-password",

  subject: () => "Réinitialiser votre mot de passe",

  body: (p) => [
    heading("Réinitialiser votre mot de passe"),
    paragraph("Cliquez pour choisir un nouveau mot de passe."),
    button("Choisir un nouveau mot de passe", p.resetUrl),
    muted(
      "Toutes vos sessions seront fermées après le changement. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.",
    ),
    fallbackLink(p.resetUrl),
  ],

  text: (p) =>
    [
      "Vous avez demandé à réinitialiser votre mot de passe.",
      "",
      `Choisir un nouveau mot de passe : ${p.resetUrl}`,
      "",
      "Toutes vos sessions seront fermées après le changement.",
      "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message :",
      "votre mot de passe reste inchangé.",
    ].join("\n"),

  sample: { resetUrl: "https://example.test/reset?token=exemple" },
});
