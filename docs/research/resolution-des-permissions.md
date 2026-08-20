# Recherche — où et à quelle fréquence résoudre les permissions

**Recherche menée en août 2026**, pour décider comment `can()` obtient les
permissions d'un acteur. Voir la décision dans
[../adr/0012-resolution-des-permissions-par-requete.md](../adr/0012-resolution-des-permissions-par-requete.md).

## La question

Une vérification par appel de `can()` produirait une requête en base à chaque
contrôle, plusieurs fois par requête HTTP. Les options allaient de la
résolution paresseuse au cache inter-requêtes avec TTL.

## Ce que dit l'état de l'art

### Point d'application centralisé

> Toute requête entrante passe par un point d'application unique, ce qui
> garantit l'uniformité des politiques et réduit le risque d'endpoints non
> protégés.

Avec un **refus par défaut** — *no accept by default*.

### Le cache inter-requêtes est la source des bugs

> Un `allow` mis en cache peut devenir faux si les permissions ou les
> relations changent, et un **contexte de locataire absent de la clé de cache
> peut faire fuiter des accès entre organizations**.

C'est exactement la classe de faille que l'[ADR 0003](../adr/0003-rls-frontiere-tenant-roles-en-code.md)
cherche à fermer — réintroduite par une optimisation.

Si un cache devient un jour nécessaire, les règles sont connues :

- clé incluant **tout** le contexte de décision : `user_id + org_id + action +
  type de ressource + id de ressource + version de politique`
- TTL courts, entrées traitées comme des indices et non comme source de vérité
- **échec fermé** en cas d'absence dans le cache
- mettre en cache les **refus** plus volontiers que les autorisations

### La propriété visée pour la révocation

> Qu'un retrait de droit prenne effet **à la requête suivante**, plutôt que
> d'exiger une nouvelle connexion.

Une variante fréquente consiste à porter les rôles dans un jeton et à
rechercher les permissions derrière un cache — les rôles étant peu nombreux et
stables, les permissions nombreuses et volatiles. Sans objet ici : les sessions
sont côté serveur, la base est déjà interrogée pour la session.

### Échouer proprement

CWE-280 — *Improper Handling of Insufficient Permissions or Privileges*. Les
refus d'accès sont un événement **normal** dans une application sécurisée ;
leur traitement doit être centralisé et prévisible, sous peine de laisser
l'application dans un état imprévisible pouvant mener à un contournement.

## Ce qui a été retenu

**Résolution une fois par requête HTTP, aucun cache inter-requêtes.**

La version propre se trouve être la plus simple :

- une seule requête en base, dans le middleware, ramenant appartenance **et**
  permissions
- le jeu de permissions vit sur le contexte de la requête ; `can()` n'accède
  jamais à la base
- la révocation prend effet à la requête suivante, **gratuitement** — rien à
  invalider
- aucune clé de cache à composer, donc aucune fuite possible par clé mal formée

Le cache inter-requêtes est une optimisation à ajouter **une fois mesurée**,
avec les règles ci-dessus.

## Ce qui a été écarté

**Tenir la transaction ouverte pendant toute la requête**, pour que permissions
et données partagent le même instantané MVCC. Plus cohérent en théorie, mais
mobiliser une connexion du pool pendant tout le traitement HTTP est un
anti-patron reconnu. La fenêtre de course entre le middleware et le handler se
compte en microsecondes et existe dans tous les systèmes.

**Une requête par appel de `can()`.** Correct, mais multiplie les
allers-retours sans bénéfice : la source ne change pas au cours d'une requête.

## Sources

- [Authorization Cheat Sheet | OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [Microservices Security Cheat Sheet | OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Microservices_Security_Cheat_Sheet.html)
- [Authorization best practices and patterns — WorkOS](https://workos.com/blog/python-authorization-best-practices)
- [Authorization best practices — Microsoft Learn](https://learn.microsoft.com/en-us/security/zero-trust/develop/developer-strategy-authorization-best-practices)
