# ADR 0017 — La validation d'un document s'applique à l'écriture seulement

**Statut** : Accepté
**Date** : 2026-08-21

## Contexte

[content-schemas.md](../architecture/content-schemas.md) décide que la
validation d'un document se fait à l'API, par un schéma Zod **généré
dynamiquement** depuis la définition stockée. Il ne disait pas **quand**.

La question n'est pas cosmétique, et elle ne se pose vraiment qu'à partir du
moment où un schéma peut changer — donc en même temps que son versionnage
([ADR 0016](0016-versionnage-des-schemas-adresse-par-contenu.md)). Les deux se
tranchent ensemble, sans quoi le second suppose une réponse au premier sans la
nommer.

## Décision

**À l'écriture. Jamais à la lecture.** Une lecture rend ce qui est stocké.

Ce qui en découle mécaniquement :

- Ajouter un champ obligatoire ne casse **rien** rétroactivement. La contrainte
  s'applique à la prochaine modification du document
- Supprimer un champ laisse des données orphelines dans le `data` JSONB, sans
  conséquence : personne ne les lit
- Un document se remet en conformité **naturellement**, à sa prochaine écriture

⚠️ **C'est ce qui rend une restauration de schéma inoffensive.** Sans cette
règle, remettre `current_hash` sur une version antérieure invaliderait
instantanément tout le contenu écrit depuis — et un mécanisme conçu pour
réparer une erreur en créerait une plus grande.

## Alternatives écartées

**Valider à l'écriture *et* à la lecture.** Tout serait toujours conforme, ce
qui est séduisant sur le papier. Écarté parce que ça transforme **chaque
modification de schéma en incident de production** : au moment où un client
ajoute un champ obligatoire, tous ses documents existants cessent d'être
lisibles. Un changement d'une ligne dans une interface d'administration
prendrait le rang d'un déploiement.

C'est aussi ce que ne font ni Sanity ni Contentful.

**Revalider en masse à chaque changement de schéma**, en marquant les documents
non conformes. Écarté : ça déplace le coût sans le supprimer — il faut alors un
état « invalide » à afficher, à filtrer et à réparer, pour une situation qui se
résout d'elle-même à la prochaine écriture.

## Conséquences

⚠️ **Ce qui casse n'est jamais le stockage, c'est le site du client.** Un site
qui suppose la présence d'un champ absent des anciens documents affichera du
vide, ou plantera. C'est le coût réel de ce choix, et il faut le dire dans la
documentation destinée aux clients plutôt que le découvrir.

**Le SDK type les champs comme facultatifs.** C'est la contrepartie honnête :
si un document peut ne pas porter un champ, le type ne doit pas prétendre le
contraire.

**JSONB tolère les deux sens** — clés en trop, clés manquantes. Aucune
contrainte de base n'est à poser, et aucune migration de contenu n'a lieu quand
un schéma change.

**Aucun verrou entre la version d'un schéma et les documents écrits sous
elle.** On sait quel schéma un document utilise, pas sous quelle version il a
été écrit. C'est une information qu'on pourrait vouloir un jour — pour un
diagnostic, pas pour la validation — et rien ici ne l'interdit d'ajouter.
