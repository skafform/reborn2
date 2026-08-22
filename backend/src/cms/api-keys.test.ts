import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PERMISSIONS } from "../config/permissions.ts";
import { API_KEY_PERMISSIONS } from "./api-keys.ts";
import { CMS_PERMISSIONS } from "./permissions.ts";

/**
 * ⚠️ **Une table de correspondance, testée comme telle.** Ces quatre
 * vérifications créaient une vraie clé et touchaient la base pour lire un
 * `Record` de trois entrées — le fixture n'existait que pour atteindre une
 * constante. Depuis que `resolveApiKey` rend le `kind` sans l'interpréter,
 * ce qu'un type accorde se vérifie sans organization, sans projet et sans
 * jeton.
 */
describe("capacités", () => {
  it("la clé publique lit, mais n'écrit pas et ne voit pas les brouillons", () => {
    const granted = new Set(API_KEY_PERMISSIONS.public);
    assert.equal(granted.has(CMS_PERMISSIONS.contentRead), true);
    assert.equal(granted.has(CMS_PERMISSIONS.contentReadDraft), false);
    assert.equal(granted.has(CMS_PERMISSIONS.contentWrite), false);
  });

  it("la clé preview voit les brouillons, sans écrire", () => {
    const granted = new Set(API_KEY_PERMISSIONS.preview);
    assert.equal(granted.has(CMS_PERMISSIONS.contentReadDraft), true);
    assert.equal(granted.has(CMS_PERMISSIONS.contentWrite), false);
  });

  it("la clé secrète écrit et publie", () => {
    const granted = new Set(API_KEY_PERMISSIONS.secret);
    assert.equal(granted.has(CMS_PERMISSIONS.contentWrite), true);
    assert.equal(granted.has(CMS_PERMISSIONS.contentPublish), true);
    assert.equal(granted.has(CMS_PERMISSIONS.schemaWrite), true);
  });

  it("aucune clé ne touche à l'administration", () => {
    for (const kind of ["public", "preview", "secret"] as const) {
      const granted = new Set(API_KEY_PERMISSIONS[kind]);
      for (const permission of [
        PERMISSIONS.memberManage,
        PERMISSIONS.roleManage,
        PERMISSIONS.apiKeyManage,
        PERMISSIONS.orgDelete,
      ] as const) {
        assert.equal(granted.has(permission), false, `${kind} / ${permission}`);
      }
    }
  });
});
