# 0005 — Policy `organizations` par appartenance

**État** : ouvert
**Priorité** : 🔴 Étape 3b, avec `organization_members`
**Ouvert le** : 2026-08-20

## Situation actuelle

La policy de lecture sur `organizations` est provisoire :

```sql
CREATE POLICY organizations_read ON organizations
  FOR SELECT USING (id = app_current_organization_id());
```

Elle suppose une organization courante. Or **« lister mes organizations » n'en
a pas** — c'est une requête transverse, et c'est la première chose que voit un
utilisateur en se connectant.

`organization_members` n'existant pas encore, cette policy était la seule
possible à l'étape 3a.

## À faire

Remplacer par une policy fondée sur l'appartenance :

```sql
USING (EXISTS (
  SELECT 1 FROM organization_members m
  WHERE m.organization_id = organizations.id
    AND m.user_id = app_current_user_id()
))
```

C'est la seule table où une sous-requête est nécessaire ; elle reste petite.
Les tables situées en dessous (`projects`, `environments`, contenu) gardent
leur policy sur la colonne de cadrage — simple et indexable, sur le chemin
chaud.

Cela reste conforme à l'[ADR 0003](../adr/0003-rls-frontiere-tenant-roles-en-code.md) :
vérifier qu'une adhésion existe est la **frontière** du locataire ; on ne
regarde jamais *quel* rôle.

## Les policies d'écriture ne changent pas

`organizations_insert` doit rester fondée sur `app_current_user_id() IS NOT
NULL` : créer une organization ne peut pas exiger d'en être déjà membre.
