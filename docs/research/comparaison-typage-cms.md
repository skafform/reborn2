# Comparaison — typage client chez Sanity, Contentful et Storyblok

**Recherche menée en août 2026**, pour trancher comment l'admin UI (dépôt
séparé) obtient un client typé de l'API. Voir la décision dans
[../architecture/api.md](../architecture/api.md).

## Ce que font les trois

### Storyblok — OpenAPI, en interne

Le client officiel `@storyblok/management-api-client` a ses **types générés à
partir de specs OpenAPI**. Détail révélateur : la spec n'a longtemps pas été
publiée publiquement — une demande ouverte en novembre 2021
([issue #732](https://github.com/storyblok/storyblok/issues/732)) est restée
sans spec publique jusqu'à l'archivage du dépôt en juin 2025. Ils s'en
servaient donc en interne pour générer leur SDK, pas comme documentation
publique.

À retenir : un acteur établi du même marché valide l'approche OpenAPI →
client généré.

### Contentful — SDKs écrits à la main

SDKs maintenus manuellement par langage. **Aucune spec OpenAPI officielle
trouvée** au moment de cette recherche ; les générateurs qui circulent sont
communautaires. Approche la plus coûteuse à maintenir, et la moins
intéressante à copier.

### Sanity — TypeGen, une approche structurellement différente

[TypeGen](https://www.sanity.io/docs/apis-and-sdks/sanity-typegen) lit le
schéma au build, analyse chaque requête GROQ annotée, et émet un
`sanity.types.ts` contenant les types exacts de chaque réponse — unions
discriminées comprises.

Sanity note lui-même que pour son API GraphQL, il recommande plutôt
l'outillage GraphQL standard : TypeGen existe spécifiquement parce que la
forme d'une réponse GROQ dépend de la *requête*, pas d'un endpoint fixe.

## L'enseignement principal

TypeGen n'est pas un choix esthétique de Sanity, c'est une **nécessité
structurelle** — et elle s'applique à tout CMS à schémas dynamiques, donc au
nôtre.

Un CMS de ce type a deux moitiés d'API de nature différente :

1. **Gestion** — organizations, projets, membres, clés, définitions de
   schémas. Formes fixes, connues à la compilation. OpenAPI les décrit
   parfaitement.
2. **Livraison de contenu** — la forme des réponses dépend des schémas créés
   par les utilisateurs, qui n'existent pas au moment de générer la spec.
   **Aucune spec statique ne peut la décrire.**

D'où le découpage retenu : OpenAPI pour la gestion (ce qui couvre 100 % du
besoin de l'admin UI), et un typage du contenu généré par projet, façon
TypeGen, reporté à plus tard — il vise les frontends des clients.

## Sources

- [@storyblok/management-api-client — npm](https://www.npmjs.com/package/@storyblok/management-api-client)
- [Storyblok — OpenAPI / Swagger spec, issue #732](https://github.com/storyblok/storyblok/issues/732)
- [Sanity TypeGen — documentation](https://www.sanity.io/docs/apis-and-sdks/sanity-typegen)
- [Introducing Sanity TypeGen](https://www.sanity.io/blog/introducing-sanity-typegen)
