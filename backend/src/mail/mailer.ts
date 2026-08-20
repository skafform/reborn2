import { Resend } from "resend";
import { env } from "../config/env.ts";
import type { Rendered } from "./template.ts";

/**
 * Port d'envoi. Le rendu d'un gabarit est une fonction pure ; seul ce qui
 * suit touche le monde extérieur.
 *
 * Isoler l'envoi derrière une interface a deux effets : les tests ne peuvent
 * pas expédier de vrai email, et changer de fournisseur — ou ajouter un outil
 * de gabarits plus riche — ne touche rien d'autre.
 */
export type Message = Rendered & { to: string };

export type Mailer = {
  send(message: Message): Promise<void>;
};

/** Capture les envois au lieu de les expédier. Utilisé par les tests. */
export type MemoryMailer = Mailer & {
  readonly sent: readonly Message[];
  clear(): void;
};

export function createMemoryMailer(): MemoryMailer {
  const sent: Message[] = [];
  return {
    sent,
    clear: () => {
      sent.length = 0;
    },
    send: async (message) => {
      sent.push(message);
    },
  };
}

/** Écrit dans la console. Sert en développement, sans clé Resend. */
export function createConsoleMailer(): Mailer {
  return {
    send: async (message) => {
      console.log(
        `\n--- email non envoyé (aucune clé Resend) ---\n` +
          `à       : ${message.to}\n` +
          `sujet   : ${message.subject}\n\n${message.text}\n---\n`,
      );
    },
  };
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  const resend = new Resend(apiKey);
  return {
    send: async (message) => {
      const { error } = await resend.emails.send({
        from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      if (error) {
        throw new Error(`envoi impossible : ${error.message}`);
      }
    },
  };
}

/**
 * Le mailer du serveur. En l'absence de clé — développement local — les
 * emails sont écrits dans la console plutôt que perdus silencieusement.
 * `env.ts` exige la clé en production, donc ce repli n'y survient jamais.
 */
export const mailer: Mailer = env.RESEND_API_KEY
  ? createResendMailer(env.RESEND_API_KEY, env.PLATFORM_MAIL_FROM)
  : createConsoleMailer();
