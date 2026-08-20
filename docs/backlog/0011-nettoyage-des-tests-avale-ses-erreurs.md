# 0011 — Le nettoyage des tests avale ses erreurs

**État** : **fait** — `src/test-support/cleanup.ts`
**Priorité** : 🟠 À faire avant d'ajouter d'autres tests d'intégration
**Ouvert le** : 2026-08-20
**Clos le** : 2026-08-20

## Le constat

Les blocs `after()` des tests d'intégration terminent par `.catch(() => {})` :

```ts
await withContext({ userId: owner.userId, organizationId }, (tx) =>
  tx.delete(organizations).where(eq(organizations.id, organizationId)),
).catch(() => {});
```

L'intention était de ne pas faire échouer une suite verte à cause d'un
nettoyage. L'effet obtenu est qu'**un nettoyage qui ne marche pas ne le dit
jamais**.

Il ne marchait pas. La suppression d'organization est impossible
([0010](0010-suppression-d-organization-bloquee.md)), donc **chaque exécution de
la suite laissait tout derrière elle**, depuis le début.

Au moment de la découverte : **305 organizations, 579 comptes, 231
invitations** dans la base de développement.

## Pourquoi ça compte au-delà du désordre

- Un `catch` silencieux est explicitement proscrit par les règles du projet.
  Celui-ci a caché un défaut fonctionnel réel pendant toute la construction du
  socle
- Les tests deviennent lents et fragiles à mesure que la base grossit
- Un test qui filtre mal — par nom plutôt que par organization, ce qui est déjà
  arrivé — voit d'autant plus de lignes étrangères qu'il en traîne

## Ce qui a été fait

**Un nettoyage unique, partagé, qui n'avale rien** : `src/test-support/cleanup.ts`,
appelé par les cinq suites d'intégration.

`destroyOrganization` respecte l'ordre imposé par les contraintes — les projets
d'abord, parce que `projects.organization_id` est en `ON DELETE RESTRICT` ; ce
qui emporte environnements puis clés API. L'organization ensuite, qui emporte
invitations, adhésions, rôles et permissions de rôles.

`destroyUsers` supprime les comptes, ce que personne ne faisait : `account`,
`session` et les adhésions suivent en cascade. C'est la source des 579 comptes.

**Aucun `.catch(() => {})` ne subsiste dans les tests.**

## Vérifié

Une exécution complète de la suite laisse la base **exactement comme elle l'a
trouvée** :

```
avant : orgs=0 users=0 projects=0 invitations=0 api_keys=0
après : orgs=0 users=0 projects=0 invitations=0 api_keys=0
```

Les 305 organizations, 605 comptes, 230 invitations et 98 projets accumulés ont
été purgés. La table `permissions` — vocabulaire commun, alimenté par migration
— a été laissée intacte : 16 lignes, conformes au catalogue en code.

## Ce qui protège maintenant

Le nettoyage **est** le test de non-régression de
[0010](0010-suppression-d-organization-bloquee.md) : si la suppression
d'organization se recasse, les cinq suites tombent au lieu de se taire.
