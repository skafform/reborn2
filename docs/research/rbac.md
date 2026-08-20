# Recherche — RBAC en multi-tenant

**Recherche menée en août 2026**, pour choisir la forme du modèle de rôles.
Voir la décision dans
[../architecture/roles-permissions.md](../architecture/roles-permissions.md).

## Le risque principal, tel que formulé par l'état de l'art

> RBAC échoue rarement parce que le schéma est faux — il échoue parce que **les
> règles autour du schéma n'ont jamais été décidées**, produisant des cas
> particuliers non documentés et une application incohérente.

D'où la discipline retenue : une matrice **purement déclarative**, sans
exception à compléter en code, et une règle de découpage explicite.

## Recommandations convergentes

- Des permissions sous forme de **chaînes d'action atomiques**
  (`read:reports`, `write:billing`), composées en rôles
- Ne pas figer la correspondance rôle → permission dans les vérifications
  elles-mêmes : *« cela rend la logique d'autorisation rigide et
  constamment à mettre à jour »*
- Exposer des **regroupements** correspondant à des concepts produit, tout en
  stockant des permissions atomiques en dessous
- Des rôles **cadrés par locataire**, jamais globaux — un `admin` l'est d'une
  organization, pas du système

## Ce que font les leaders

| | Rôles personnalisés |
|---|---|
| **Sanity** | Enterprise uniquement. Le plan gratuit se limite à Admin et Editor ; RBAC apparaît au plan Growth |
| **Contentful** | RBAC avec permissions regroupées en rôles, disponible plus largement selon les paliers |

Enseignement : les rôles personnalisés sont une **fonctionnalité produit
monétisable**, pas un prérequis technique. D'où le choix de poser le motif RBAC
maintenant et de laisser les rôles personnalisés pour plus tard.

## Ce qui a été retenu

**RBAC comme motif d'implémentation**, pas encore comme fonctionnalité :

- Catalogue de permissions atomiques
- Correspondance rôle → permissions dans une constante versionnée en code
- Un seul `can(acteur, permission, ressource)`
- Règle de découpage : *une permission existe quand elle exprime une différence
  réelle dans la matrice*

Bénéfice non anticipé : les **clés API** entrent dans le même catalogue, ce qui
évite un second système d'autorisation et se referme sur l'acteur polymorphe du
journal d'audit.

**Écarté** : les modèles ReBAC façon Google Zanzibar (OpenFGA, SpiceDB). Ils
résolvent des graphes d'autorisation que ce projet n'a pas — deux niveaux de
rôles fixes ne justifient pas un moteur d'autorisation externe.

## Sources

- [How to design an RBAC model for multi-tenant SaaS — WorkOS](https://workos.com/blog/how-to-design-multi-tenant-rbac-saas)
- [Best Practices for Multi-Tenant Authorization — Permit.io](https://www.permit.io/blog/best-practices-for-multi-tenant-authorization)
- [How to Choose the Right Authorization Model for Your Multi-Tenant SaaS Application — Auth0](https://auth0.com/blog/how-to-choose-the-right-authorization-model-for-your-multi-tenant-saas-application/)
- [Roles | Sanity Docs](https://www.sanity.io/docs/user-guides/roles)
