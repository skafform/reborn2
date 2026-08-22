import type { Permission } from "../config/permissions.ts";
import type { ApiKeyKind } from "../services/api-keys.ts";
import { CMS_PERMISSIONS } from "./permissions.ts";

/**
 * Ce qu'un type de clé accorde.
 *
 * ⚠️ **Plus lu par ce module.** `resolveApiKey` rend désormais le `kind` sans
 * l'interpréter : ce qu'un type de clé *veut dire* est une question de
 * contenu, tranchée là où elle est vérifiée. La table attend son unique
 * consommateur, l'API de livraison.
 */
export const API_KEY_PERMISSIONS: Record<ApiKeyKind, readonly Permission[]> = {
  /** Sites consommateurs : contenu publié seulement. */
  public: [CMS_PERMISSIONS.contentRead, CMS_PERMISSIONS.schemaRead],
  /** Prévisualisation : y compris les brouillons. */
  preview: [
    CMS_PERMISSIONS.contentRead,
    CMS_PERMISSIONS.contentReadDraft,
    CMS_PERMISSIONS.schemaRead,
  ],
  /** Scripts de migration : lecture, écriture, publication et schémas. */
  secret: [
    CMS_PERMISSIONS.contentRead,
    CMS_PERMISSIONS.contentReadDraft,
    CMS_PERMISSIONS.contentWrite,
    CMS_PERMISSIONS.contentPublish,
    CMS_PERMISSIONS.schemaRead,
    CMS_PERMISSIONS.schemaWrite,
  ],
};
