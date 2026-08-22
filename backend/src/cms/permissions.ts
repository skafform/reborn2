import { definePermission } from "../config/permissions.ts";

/**
 * Le vocabulaire d'autorisation du CMS.
 *
 * ⚠️ **Ces clés vivaient dans le catalogue du socle**, qui n'avait aucune
 * raison de connaître les mots « contenu » et « schéma ». Mêmes clés, mêmes
 * détenteurs, même ordre — rien de ce qui est stocké ne change. Ce qui change,
 * c'est que la frontière devient vraie au lieu d'être déclarée.
 *
 * Le socle n'importe rien d'ici : une règle de lint le refuse (`biome.json`).
 * C'est ce module qui importe le socle, jamais l'inverse (ADR 0019).
 *
 * ⚠️ **Il doit être chargé au démarrage** pour que le semage des rôles système
 * voie ces permissions — `app.ts` s'en charge, et c'est le seul fichier du
 * socle autorisé à connaître ce répertoire. Sans ça, une organization neuve
 * naîtrait avec des rôles amputés.
 */
export const CMS_PERMISSIONS = {
  contentRead: definePermission("content.read", {
    description: "Read published content",
    roles: ["admin", "viewer", "editor", "contributor", "guest"],
  }),

  contentReadDraft: definePermission("content.read_draft", {
    description: "Read drafts",
    roles: ["admin", "viewer", "editor", "contributor", "guest"],
  }),

  contentWrite: definePermission("content.write", {
    description: "Create and edit content",
    roles: ["admin", "editor", "contributor"],
  }),

  contentPublish: definePermission("content.publish", {
    description: "Publish content",
    // ⚠️ `contributor` en est exclu, et c'est toute la différence entre les
    // deux rôles : écrire n'est pas publier.
    roles: ["admin", "editor"],
  }),

  schemaRead: definePermission("schema.read", {
    description: "Read content type definitions",
    roles: ["admin", "viewer", "editor", "contributor", "guest"],
  }),

  /**
   * ⚠️ Exclue à `editor`, même s'il peut écrire du contenu : modifier un
   * schéma est un changement **structurel**, qui peut casser des documents
   * existants — pas une modification de contenu
   * (architecture/content-schemas.md).
   */
  schemaWrite: definePermission("schema.write", {
    description: "Create and edit content types",
    roles: ["admin"],
  }),

  /**
   * ⚠️ **Une clé distincte de `schema.write`, avec le même détenteur par
   * défaut** ([ADR 0018](../../../docs/adr/0018-bibliotheque-de-schemas-table-separee.md)).
   *
   * Le risque réel est plus faible qu'il n'en a l'air : les copies étant
   * indépendantes, éditer la bibliothèque ne casse rien d'existant — d'où
   * `owner` **et** `admin`. Elle est séparée parce que ce défaut sera
   * probablement revisité, et que le restreindre au seul `owner` doit rester
   * un ajustement de rôle, pas une chirurgie du catalogue.
   *
   * ⚠️ **Lire la bibliothèque n'a pas de clé à elle** : c'est `schema.read`.
   * Une clé de lecture de plus ne réglerait aucun problème qu'on ait.
   */
  libraryWrite: definePermission("library.write", {
    description: "Curate the organization's schema library",
    roles: ["admin"],
  }),
} as const;
