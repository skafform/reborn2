import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { and, eq } from "drizzle-orm";
import { app } from "../app.ts";
import { closePool, withContext } from "../db/client.ts";
import { organizationMembers, projectMembers, roles } from "../db/schema.ts";
import { destroyOrganization, destroyUsers } from "../test-support/cleanup.ts";
import { createVerifiedUser } from "../test-support/users.ts";

/**
 * Éprouve la chaîne complète : session, middleware, `can()`, service, RLS.
 *
 * Le point le plus important est la distinction 404 / 403 — un 403 sur une
 * organization dont on n'est pas membre en confirmerait l'existence
 * (ADR 0012).
 */
type Session = { cookie: string; userId: string; email: string };

async function signUp(prefix: string): Promise<Session> {
  const user = await createVerifiedUser(prefix);
  return { cookie: user.cookie, userId: user.id, email: user.email };
}

const call = (path: string, session: Session, init: RequestInit = {}) =>
  app.request(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      cookie: session.cookie,
      ...(init.headers as Record<string, string> | undefined),
    },
  });

describe("fournisseurs OAuth", () => {
  /**
   * ⚠️ **Le contenu de la liste n'est pas affirmé, et ne peut pas l'être.**
   * Une première version exigeait `{ providers: [] }` ; elle passait parce que
   * l'environnement n'avait pas encore d'application OAuth, et a cassé le jour
   * où on en a configuré une. Elle affirmait une propriété du **déploiement**,
   * ce qui est précisément la raison d'être de cette route.
   *
   * Ce qui se teste ici est ce qui ne dépend pas de la configuration : la
   * route répond sans session, et sa forme tient le contrat.
   */
  it("répond sans session, et rend une liste de fournisseurs", async () => {
    // Sans session, parce qu'un client doit savoir quels boutons de connexion
    // afficher **avant** d'en avoir une.
    const response = await app.request("/api/auth-providers");
    assert.equal(response.status, 200);

    const body = (await response.json()) as { providers: unknown };
    assert.ok(Array.isArray(body.providers));
    assert.ok(body.providers.every((id) => typeof id === "string" && id.length > 0));
  });
});

describe("routes de gestion", () => {
  let owner: Session;
  let viewer: Session;
  let outsider: Session;
  let organizationId = "";
  /** Tous les comptes créés par la suite, y compris par ses sous-suites. */
  const sessions: Session[] = [];

  /**
   * Un compte neuf, attaché à l'organization de la suite avec un rôle système.
   *
   * Neuf à chaque fois plutôt que partagé : renommer ou promouvoir un compte
   * commun a déjà cassé un autre test de ce fichier.
   */
  async function memberWithRole(prefix: string, roleName: string): Promise<Session> {
    const session = await signUp(prefix);
    sessions.push(session);

    await withContext({ userId: owner.userId, organizationId }, async (tx) => {
      const [role] = await tx
        .select()
        .from(roles)
        .where(and(eq(roles.organizationId, organizationId), eq(roles.name, roleName)));
      assert.ok(role, `le rôle système ${roleName} existe dans toute organization`);
      await tx.insert(organizationMembers).values({
        organizationId,
        userId: session.userId,
        roleId: role.id,
      });
    });

    return session;
  }

  before(async () => {
    owner = await signUp("owner");
    outsider = await signUp("outsider");
    sessions.push(owner, outsider);

    const response = await call("/api/organizations", owner, {
      method: "POST",
      body: JSON.stringify({ name: "Acme" }),
    });
    assert.equal(response.status, 201);
    organizationId = ((await response.json()) as { id: string }).id;

    viewer = await memberWithRole("viewer", "viewer");
  });

  after(async () => {
    await destroyOrganization(owner.userId, organizationId);
    await destroyUsers(sessions.map((s) => s.userId));
    await closePool();
  });

  it("refuse une requête sans session", async () => {
    const response = await app.request("/api/organizations");
    assert.equal(response.status, 401);
  });

  it("ne liste que les organizations de l'utilisateur", async () => {
    const mine = await call("/api/organizations", owner);
    const list = (await mine.json()) as { id: string; name: string }[];
    assert.ok(list.some((o) => o.id === organizationId));

    const theirs = await call("/api/organizations", outsider);
    const empty = (await theirs.json()) as { id: string }[];
    assert.ok(!empty.some((o) => o.id === organizationId));
  });

  it("liste les membres avec leur rôle et leur adresse", async () => {
    const response = await call(`/api/organizations/${organizationId}/members`, owner);
    assert.equal(response.status, 200);

    const list = (await response.json()) as {
      userId: string;
      email: string;
      roleName: string;
    }[];

    assert.equal(list.length, 2, "le owner et le viewer ajouté à la préparation");
    assert.equal(list.find((m) => m.userId === owner.userId)?.roleName, "owner");
    assert.equal(list.find((m) => m.userId === viewer.userId)?.roleName, "viewer");
    assert.ok(
      list.every((m) => m.email.includes("@")),
      "l'adresse vient de la table de Better-Auth, jointe en SQL",
    );
  });

  it("laisse un viewer voir les membres, sans pouvoir inviter", async () => {
    const read = await call(`/api/organizations/${organizationId}/members`, viewer);
    assert.equal(read.status, 200, "un viewer est « un admin sans écriture »");

    const pending = await call(
      `/api/organizations/${organizationId}/invitations`,
      viewer,
    );
    assert.equal(
      pending.status,
      403,
      "une invitation en attente relève du recrutement, pas de l'annuaire",
    );

    // La séparation `member.read` / `member.manage` n'a de sens que si la
    // seconde reste refusée — sinon les deux permissions n'en feraient qu'une.
    //
    // Un vrai `roleId` est nécessaire : le service résout le rôle **avant**
    // d'appliquer la règle d'escalade, donc un identifiant inventé donnerait
    // un 404 « rôle introuvable » qui ne prouverait rien sur les permissions.
    const [viewerRole] = await withContext(
      { userId: owner.userId, organizationId },
      (tx) =>
        tx
          .select()
          .from(roles)
          .where(
            and(eq(roles.organizationId, organizationId), eq(roles.name, "viewer")),
          ),
    );
    assert.ok(viewerRole);

    const invite = await call(
      `/api/organizations/${organizationId}/invitations`,
      viewer,
      {
        method: "POST",
        body: JSON.stringify({ email: "x@skafform.test", roleId: viewerRole.id }),
      },
    );
    assert.equal(invite.status, 403);
  });

  it("expose les permissions de l'acteur, sans le nom du rôle", async () => {
    const asViewer = await call(`/api/organizations/${organizationId}/me`, viewer);
    assert.equal(asViewer.status, 200);
    const viewerPermissions = ((await asViewer.json()) as { permissions: string[] })
      .permissions;
    assert.ok(viewerPermissions.includes("member.read"));
    assert.ok(!viewerPermissions.includes("member.manage"));

    const asOwner = await call(`/api/organizations/${organizationId}/me`, owner);
    const ownerPermissions = ((await asOwner.json()) as { permissions: string[] })
      .permissions;
    assert.ok(ownerPermissions.includes("member.manage"));
  });

  it("ne montre pas les membres d'une organization à un étranger", async () => {
    const response = await call(
      `/api/organizations/${organizationId}/members`,
      outsider,
    );
    assert.equal(response.status, 404);
  });

  it("liste les rôles d'une organization, des deux portées", async () => {
    const response = await call(`/api/organizations/${organizationId}/roles`, owner);
    assert.equal(response.status, 200);

    const list = (await response.json()) as {
      name: string;
      scope: string;
      isSystem: boolean;
    }[];

    // Filtré sur `isSystem` : d'autres tests de ce fichier créent des rôles
    // personnalisés dans la même organization, et sans ce filtre cette
    // assertion ne tiendrait que par l'ordre d'exécution.
    const system = list.filter((role) => role.isSystem);
    assert.deepEqual(
      system
        .filter((role) => role.scope === "organization")
        .map((r) => r.name)
        .sort(),
      ["admin", "owner", "viewer"],
    );
    assert.deepEqual(
      system
        .filter((role) => role.scope === "project")
        .map((r) => r.name)
        .sort(),
      ["contributor", "editor", "guest"],
    );
  });

  /**
   * Régression du cas rencontré en éprouvant la console : un `admin` voyait
   * `owner` et `admin` dans le menu d'invitation, et son invitation échouait
   * en 403. Le serveur dit maintenant, par rôle, s'il est assignable — même
   * garde-fou que celui qui refuserait ensuite.
   */
  it("dit quels rôles l'appelant peut réellement assigner", async () => {
    type ListedRole = { name: string; scope: string; assignable: boolean };
    const verdicts = async (session: Session) => {
      const response = await call(
        `/api/organizations/${organizationId}/roles`,
        session,
      );
      const list = (await response.json()) as ListedRole[];
      return Object.fromEntries(list.map((role) => [role.name, role.assignable]));
    };

    // Le owner détient tout le catalogue : rien ne lui échappe.
    const forOwner = await verdicts(owner);
    assert.equal(forOwner.owner, true);
    assert.equal(forOwner.admin, true);
    assert.equal(forOwner.viewer, true);

    // Un admin promu pour l'occasion : `member.manage_admin` lui manque, donc
    // ni `owner` ni `admin` — mais `viewer`, dont il détient toutes les
    // permissions, reste assignable.
    const promu = await signUp("assignable-admin");
    const [adminRole] = await withContext(
      { userId: owner.userId, organizationId },
      (tx) =>
        tx
          .select()
          .from(roles)
          .where(
            and(eq(roles.organizationId, organizationId), eq(roles.name, "admin")),
          ),
    );
    assert.ok(adminRole);
    await withContext({ userId: owner.userId, organizationId }, (tx) =>
      tx.insert(organizationMembers).values({
        organizationId,
        userId: promu.userId,
        roleId: adminRole.id,
      }),
    );

    const forAdmin = await verdicts(promu);
    assert.equal(forAdmin.owner, false, "un admin ne promeut pas vers owner");
    assert.equal(forAdmin.admin, false, "ni vers son propre niveau");
    assert.equal(forAdmin.viewer, true);

    // Le verdict et le refus doivent dire la même chose : sinon l'interface
    // masquerait autre chose que ce que le serveur refuse.
    const refused = await call(
      `/api/organizations/${organizationId}/invitations`,
      promu,
      {
        method: "POST",
        body: JSON.stringify({ email: "x@skafform.test", roleId: adminRole.id }),
      },
    );
    assert.equal(refused.status, 403);

    await withContext({ userId: owner.userId, organizationId }, (tx) =>
      tx
        .delete(organizationMembers)
        .where(
          and(
            eq(organizationMembers.organizationId, organizationId),
            eq(organizationMembers.userId, promu.userId),
          ),
        ),
    );
    await destroyUsers([promu.userId]);
  });

  it("refuse la liste des rôles à qui ne gère pas les membres", async () => {
    const response = await call(`/api/organizations/${organizationId}/roles`, viewer);
    assert.equal(
      response.status,
      403,
      "elle sert à attribuer un rôle, pas à en consulter le catalogue",
    );
  });

  it("ne montre pas les rôles d'une organization à un étranger", async () => {
    const response = await call(`/api/organizations/${organizationId}/roles`, outsider);
    assert.equal(
      response.status,
      404,
      "404 et non 403 : l'existence même de l'organization ne doit pas fuir",
    );
  });

  it("laisse le owner créer un projet", async () => {
    const response = await call(
      `/api/organizations/${organizationId}/projects`,
      owner,
      { method: "POST", body: JSON.stringify({ name: "Site Client A" }) },
    );
    assert.equal(response.status, 201);
  });

  it("répond 403 à un viewer qui tente de créer un projet", async () => {
    const response = await call(
      `/api/organizations/${organizationId}/projects`,
      viewer,
      { method: "POST", body: JSON.stringify({ name: "Interdit" }) },
    );
    assert.equal(
      response.status,
      403,
      "il voit l'organization : il n'y a plus rien à cacher",
    );
    const body = (await response.json()) as { reason: string };
    assert.equal(body.reason, "missing_permission");
  });

  it("laisse le viewer lire les projets", async () => {
    const response = await call(
      `/api/organizations/${organizationId}/projects`,
      viewer,
    );
    assert.equal(response.status, 200);
    const projects = (await response.json()) as unknown[];
    assert.ok(projects.length >= 1);
  });

  it("répond 404 — et non 403 — à un étranger", async () => {
    const read = await call(`/api/organizations/${organizationId}/projects`, outsider);
    assert.equal(read.status, 404, "un 403 confirmerait l'existence de l'organization");

    const write = await call(
      `/api/organizations/${organizationId}/projects`,
      outsider,
      { method: "POST", body: JSON.stringify({ name: "Intrusion" }) },
    );
    assert.equal(write.status, 404);
  });

  it("répond 404 sur une organization inexistante", async () => {
    const response = await call(`/api/organizations/${randomUUID()}/projects`, owner);
    assert.equal(
      response.status,
      404,
      "indiscernable d'une organization existante mais inaccessible",
    );
  });

  /**
   * Un membre de projet est extérieur à l'organization : aucune ligne dans
   * `organization_members`. Il doit malgré tout la voir dans son sélecteur et
   * atteindre son projet — sans rien voir des autres
   * (architecture/multi-tenant.md).
   */
  describe("membre de projet", () => {
    let pigiste: Session;
    let sien = "";
    let autre = "";

    before(async () => {
      pigiste = await signUp("pigiste");
      sessions.push(pigiste);

      const create = async (name: string) => {
        const response = await call(
          `/api/organizations/${organizationId}/projects`,
          owner,
          { method: "POST", body: JSON.stringify({ name }) },
        );
        return ((await response.json()) as { id: string }).id;
      };
      sien = await create("Le sien");
      autre = await create("Pas le sien");

      await withContext({ userId: owner.userId, organizationId }, async (tx) => {
        const [role] = await tx
          .select()
          .from(roles)
          .where(
            and(eq(roles.organizationId, organizationId), eq(roles.name, "editor")),
          );
        assert.ok(role);
        await tx.insert(projectMembers).values({
          projectId: sien,
          organizationId,
          userId: pigiste.userId,
          roleId: role.id,
        });
      });
    });

    it("voit l'organization hôte, sans en être membre", async () => {
      const response = await call("/api/organizations", pigiste);
      assert.equal(response.status, 200);
      const list = (await response.json()) as { id: string }[];
      assert.ok(
        list.some((o) => o.id === organizationId),
        "sans elle, son projet serait inatteignable",
      );
    });

    it("ne voit que le projet dont il est membre", async () => {
      const response = await call(
        `/api/organizations/${organizationId}/projects`,
        pigiste,
      );
      assert.equal(response.status, 200);
      const list = (await response.json()) as { id: string }[];
      assert.deepEqual(
        list.map((p) => p.id),
        [sien],
        "le nom des autres projets ne le regarde pas",
      );
    });

    /**
     * Ses permissions existent, mais aucune ne vaut sans projet cible. Les
     * rendre telles quelles ferait croire à la console qu'il peut agir sur
     * l'organization.
     */
    it("ne peut rien faire au niveau de l'organization", async () => {
      const response = await call(`/api/organizations/${organizationId}/me`, pigiste);
      assert.equal(response.status, 200);
      const { permissions } = (await response.json()) as { permissions: string[] };
      assert.deepEqual(permissions, []);
    });

    it("détient ses permissions dans son projet", async () => {
      const response = await call(
        `/api/organizations/${organizationId}/projects/${sien}/me`,
        pigiste,
      );
      assert.equal(response.status, 200);
      const { permissions } = (await response.json()) as { permissions: string[] };
      assert.ok(permissions.includes("content.write"));
      assert.ok(!permissions.includes("member.read"), "un pigiste ne recrute pas");
    });

    it("répond 404 sur un projet qui n'est pas le sien", async () => {
      for (const path of [
        `/api/organizations/${organizationId}/projects/${autre}`,
        `/api/organizations/${organizationId}/projects/${autre}/me`,
        `/api/organizations/${organizationId}/projects/${autre}/members`,
      ]) {
        const response = await call(path, pigiste);
        assert.equal(response.status, 404, `${path} ne doit rien révéler`);
      }
    });

    it("ne voit pas l'équipe de son propre projet", async () => {
      const response = await call(
        `/api/organizations/${organizationId}/projects/${sien}/members`,
        pigiste,
      );
      assert.equal(
        response.status,
        403,
        "il voit le projet : il n'y a plus rien à cacher, seulement à refuser",
      );
    });

    /**
     * Le recrutement d'un projet vit dans ce projet. Les deux listes doivent
     * donc rester séparées — sinon l'équipe de l'organization afficherait des
     * invitations qu'on n'y a pas envoyées.
     */
    it("garde les invitations d'un projet hors de celles de l'organization", async () => {
      const [editorRole] = await withContext(
        { userId: owner.userId, organizationId },
        (tx) =>
          tx
            .select()
            .from(roles)
            .where(
              and(eq(roles.organizationId, organizationId), eq(roles.name, "editor")),
            ),
      );
      assert.ok(editorRole);

      const sent = await call(
        `/api/organizations/${organizationId}/projects/${sien}/invitations`,
        owner,
        {
          method: "POST",
          // Aucun `projectId` dans le corps : il vient de l'URL.
          body: JSON.stringify({
            email: `recrue-${randomUUID()}@skafform.test`,
            roleId: editorRole.id,
          }),
        },
      );
      assert.equal(sent.status, 201);
      const { id } = (await sent.json()) as { id: string };

      const onProject = await call(
        `/api/organizations/${organizationId}/projects/${sien}/invitations`,
        owner,
      );
      const projectList = (await onProject.json()) as { id: string }[];
      assert.ok(projectList.some((i) => i.id === id));

      const onOrganization = await call(
        `/api/organizations/${organizationId}/invitations`,
        owner,
      );
      const organizationList = (await onOrganization.json()) as { id: string }[];
      assert.ok(
        !organizationList.some((i) => i.id === id),
        "elle appartient au projet, pas à l'organization",
      );
    });

    it("le owner, lui, voit l'équipe du projet", async () => {
      const response = await call(
        `/api/organizations/${organizationId}/projects/${sien}/members`,
        owner,
      );
      assert.equal(response.status, 200);
      const members = (await response.json()) as { userId: string; roleName: string }[];
      assert.deepEqual(
        members.map((m) => m.userId),
        [pigiste.userId],
      );
      assert.equal(members[0]?.roleName, "editor");
    });
  });

  /**
   * Les services vérifient déjà `apikey.manage` — ces tests éprouvent ce que
   * les routes ajoutent : la résolution de l'environnement `master`, l'ordre
   * révoquer-puis-supprimer, et le fait qu'une `ApiKeyError` ressorte avec son
   * statut plutôt qu'en 500.
   */
  /**
   * Retirer, suspendre, changer de rôle. Les trois obéissent à la même règle —
   * `owner` et `admin` exigent `member.manage_admin` — et deux d'entre elles
   * rencontrent le garde-fou du dernier propriétaire, qui se déclenche **au
   * commit** et non à l'instruction.
   */
  describe("adhésions", () => {
    let membre: Session;
    let membreOrg = "";
    let viewerRoleId = "";
    let adminRoleId = "";

    const roleIdFor = async (name: string) => {
      const [role] = await withContext({ userId: owner.userId, organizationId }, (tx) =>
        tx
          .select()
          .from(roles)
          .where(and(eq(roles.organizationId, organizationId), eq(roles.name, name))),
      );
      assert.ok(role);
      return role.id;
    };

    before(async () => {
      viewerRoleId = await roleIdFor("viewer");
      adminRoleId = await roleIdFor("admin");

      // Une organization à part : y toucher au dernier `owner` ne perturbe pas
      // le reste de la suite.
      membre = await signUp("membre");
      sessions.push(membre);
      const created = await call("/api/organizations", membre, {
        method: "POST",
        body: JSON.stringify({ name: "Chez le membre" }),
      });
      membreOrg = ((await created.json()) as { id: string }).id;
    });

    after(async () => {
      await destroyOrganization(membre.userId, membreOrg);
    });

    it("dit par membre ce que l'appelant peut en faire", async () => {
      const asOwner = (await (
        await call(`/api/organizations/${organizationId}/members`, owner)
      ).json()) as { userId: string; manageable: boolean }[];
      assert.ok(
        asOwner.every((m) => m.manageable),
        "un owner peut agir sur tout le monde",
      );

      const asViewer = (await (
        await call(`/api/organizations/${organizationId}/members`, viewer)
      ).json()) as { manageable: boolean }[];
      assert.ok(
        asViewer.every((m) => !m.manageable),
        "un viewer ne gère personne — et la console n'a pas à le déduire",
      );
    });

    it("refuse de retirer le dernier owner, sans passer par un 500", async () => {
      const response = await call(
        `/api/organizations/${membreOrg}/members/${membre.userId}`,
        membre,
        { method: "DELETE" },
      );
      assert.equal(
        response.status,
        409,
        "le trigger est différé : sans traduction au bon endroit, ce serait un 500",
      );
      assert.equal(
        ((await response.json()) as { reason: string }).reason,
        "last_owner",
      );
    });

    it("refuse aussi de le suspendre — l'organization deviendrait orpheline", async () => {
      // Par un tiers, puisqu'on ne peut pas se suspendre soi-même : le owner de
      // `Chez le membre` promeut d'abord un admin, qui tente ensuite.
      const complice = await signUp("complice");
      sessions.push(complice);
      const [adminAilleurs] = await withContext(
        { userId: membre.userId, organizationId: membreOrg },
        (tx) =>
          tx
            .select()
            .from(roles)
            .where(and(eq(roles.organizationId, membreOrg), eq(roles.name, "owner"))),
      );
      assert.ok(adminAilleurs);
      await withContext({ userId: membre.userId, organizationId: membreOrg }, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId: membreOrg,
          userId: complice.userId,
          roleId: adminAilleurs.id,
        }),
      );

      // Deux owners : suspendre l'un passe.
      const premier = await call(
        `/api/organizations/${membreOrg}/members/${membre.userId}/suspension`,
        complice,
        { method: "PUT", body: JSON.stringify({ suspended: true }) },
      );
      assert.equal(premier.status, 204);

      // Le second est désormais seul actif : se suspendre est refusé d'emblée,
      // et le retirer heurte le garde-fou.
      const seul = await call(
        `/api/organizations/${membreOrg}/members/${complice.userId}`,
        complice,
        { method: "DELETE" },
      );
      assert.equal(seul.status, 409);
      assert.equal(((await seul.json()) as { reason: string }).reason, "last_owner");

      // Remis en état pour le nettoyage de fin.
      await call(
        `/api/organizations/${membreOrg}/members/${membre.userId}/suspension`,
        complice,
        { method: "PUT", body: JSON.stringify({ suspended: false }) },
      );
    });

    it("coupe l'accès d'un membre suspendu, sans le retirer", async () => {
      const suspendu = await signUp("suspendu");
      sessions.push(suspendu);
      await withContext({ userId: owner.userId, organizationId }, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId,
          userId: suspendu.userId,
          roleId: viewerRoleId,
        }),
      );

      assert.equal(
        (await call(`/api/organizations/${organizationId}/me`, suspendu)).status,
        200,
      );

      const applied = await call(
        `/api/organizations/${organizationId}/members/${suspendu.userId}/suspension`,
        owner,
        { method: "PUT", body: JSON.stringify({ suspended: true }) },
      );
      assert.equal(applied.status, 204);

      assert.equal(
        (await call(`/api/organizations/${organizationId}/me`, suspendu)).status,
        404,
        "aucun grant n'est rendu — donc l'organization est indiscernable d'inexistante",
      );

      const visibles = (await (await call("/api/organizations", suspendu)).json()) as {
        id: string;
      }[];
      assert.ok(
        !visibles.some((o) => o.id === organizationId),
        "elle disparaît aussi du sélecteur, sinon tout répondrait 404 derrière",
      );

      // Toujours listée du côté de ceux qui gèrent : l'adhésion existe.
      const listed = (await (
        await call(`/api/organizations/${organizationId}/members`, owner)
      ).json()) as { userId: string; suspendedAt: string | null }[];
      assert.ok(listed.find((m) => m.userId === suspendu.userId)?.suspendedAt);

      // Réactivée, elle revaut.
      await call(
        `/api/organizations/${organizationId}/members/${suspendu.userId}/suspension`,
        owner,
        { method: "PUT", body: JSON.stringify({ suspended: false }) },
      );
      assert.equal(
        (await call(`/api/organizations/${organizationId}/me`, suspendu)).status,
        200,
      );

      await call(
        `/api/organizations/${organizationId}/members/${suspendu.userId}`,
        owner,
        { method: "DELETE" },
      );
    });

    it("refuse qu'on se suspende soi-même", async () => {
      const response = await call(
        `/api/organizations/${organizationId}/members/${owner.userId}/suspension`,
        owner,
        { method: "PUT", body: JSON.stringify({ suspended: true }) },
      );
      assert.equal(response.status, 409);
      assert.equal(
        ((await response.json()) as { reason: string }).reason,
        "self_suspend",
        "on se couperait l'accès sans pouvoir revenir",
      );
    });

    /**
     * Le cas qui distingue les deux garde-fous : un `admin` détient
     * `member.manage`, donc il pourrait toucher un `viewer` — mais pas un
     * `owner`, ce qui exige `member.manage_admin`.
     */
    it("empêche un admin de rétrograder un owner", async () => {
      const admin = await signUp("admin-degrade");
      sessions.push(admin);
      await withContext({ userId: owner.userId, organizationId }, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId,
          userId: admin.userId,
          roleId: adminRoleId,
        }),
      );

      const response = await call(
        `/api/organizations/${organizationId}/members/${owner.userId}/role`,
        admin,
        { method: "PUT", body: JSON.stringify({ roleId: viewerRoleId }) },
      );
      assert.equal(response.status, 403);
      assert.equal(
        ((await response.json()) as { reason: string }).reason,
        "missing_permission",
      );

      await call(
        `/api/organizations/${organizationId}/members/${admin.userId}`,
        owner,
        {
          method: "DELETE",
        },
      );
    });

    it("refuse un rôle de projet sur une adhésion d'organization", async () => {
      const cible = await signUp("mauvaise-portee");
      sessions.push(cible);
      await withContext({ userId: owner.userId, organizationId }, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId,
          userId: cible.userId,
          roleId: viewerRoleId,
        }),
      );

      const response = await call(
        `/api/organizations/${organizationId}/members/${cible.userId}/role`,
        owner,
        { method: "PUT", body: JSON.stringify({ roleId: await roleIdFor("editor") }) },
      );
      assert.equal(
        response.status,
        409,
        "sinon ses permissions vaudraient sur tous les projets",
      );
      assert.equal(
        ((await response.json()) as { reason: string }).reason,
        "scope_mismatch",
      );

      await call(
        `/api/organizations/${organizationId}/members/${cible.userId}`,
        owner,
        {
          method: "DELETE",
        },
      );
    });

    it("laisse quelqu'un partir de lui-même, sans permission", async () => {
      const partant = await signUp("partant");
      sessions.push(partant);
      await withContext({ userId: owner.userId, organizationId }, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId,
          userId: partant.userId,
          roleId: viewerRoleId,
        }),
      );

      const response = await call(
        `/api/organizations/${organizationId}/members/${partant.userId}`,
        partant,
        { method: "DELETE" },
      );
      assert.equal(response.status, 204, "un viewer n'a pas `member.manage`");

      assert.equal(
        (await call(`/api/organizations/${organizationId}/me`, partant)).status,
        404,
      );
    });
  });

  /**
   * Custom roles. Only an owner writes here (ADR 0014) — an admin assigns what
   * exists. The rest is what the screen leans on: system roles are readable
   * but frozen, and a role somebody wears is emptied before it is deleted.
   */
  /**
   * Renaming and deleting. Until now an organization created through the API
   * could never leave it, and neither could a project.
   */
  describe("cycle de vie", () => {
    /**
     * On its own organization, never the suite's: renaming a shared fixture
     * broke the Inbox test, which reads that name. The same order-dependency
     * trap as the role list.
     */
    it("saves the name and description of an organization and a project", async () => {
      const mover = await signUp("renommeur");
      sessions.push(mover);
      const created = await call("/api/organizations", mover, {
        method: "POST",
        body: JSON.stringify({ name: "Avant" }),
      });
      const { id: orgId } = (await created.json()) as { id: string };

      const renamed = await call(`/api/organizations/${orgId}`, mover, {
        method: "PUT",
        body: JSON.stringify({ name: "Après", description: "Ce qu'elle fait" }),
      });
      assert.equal(renamed.status, 200);
      assert.deepEqual(
        (await renamed.json()) as { name: string; description: string },
        { id: orgId, name: "Après", description: "Ce qu'elle fait" },
      );

      const project = await call(`/api/organizations/${orgId}/projects`, mover, {
        method: "POST",
        body: JSON.stringify({ name: "Projet avant" }),
      });
      const { id: projectId } = (await project.json()) as { id: string };

      const moved = await call(
        `/api/organizations/${orgId}/projects/${projectId}`,
        mover,
        {
          method: "PUT",
          body: JSON.stringify({ name: "Projet après", description: "Le site" }),
        },
      );
      assert.deepEqual((await moved.json()) as { name: string; description: string }, {
        id: projectId,
        name: "Projet après",
        description: "Le site",
      });

      await call(`/api/organizations/${orgId}/projects/${projectId}`, mover, {
        method: "DELETE",
      });
      assert.equal(
        (await call(`/api/organizations/${orgId}`, mover, { method: "DELETE" })).status,
        204,
      );
    });

    /**
     * ⚠️ Le point de la migration 0027. `org.settings` couvrait les deux ;
     * l'avoir réservé au owner sans scinder aurait retiré aux admins le droit
     * de nommer les projets qu'ils créent.
     */
    it("separates organization settings from project settings", async () => {
      const admin = await memberWithRole("reglages", "admin");

      const project = await call(
        `/api/organizations/${organizationId}/projects`,
        owner,
        { method: "POST", body: JSON.stringify({ name: "Confié" }) },
      );
      const { id: projectId } = (await project.json()) as { id: string };

      const onProject = await call(
        `/api/organizations/${organizationId}/projects/${projectId}`,
        admin,
        {
          method: "PUT",
          body: JSON.stringify({ name: "Renommé", description: "Par l'admin" }),
        },
      );
      assert.equal(onProject.status, 200, "`project.settings` reste à l'admin");

      const onOrganization = await call(`/api/organizations/${organizationId}`, admin, {
        method: "PUT",
        body: JSON.stringify({ name: "Détournée", description: "" }),
      });
      assert.equal(onOrganization.status, 403, "`org.settings` est au owner seul");

      await call(`/api/organizations/${organizationId}/projects/${projectId}`, owner, {
        method: "DELETE",
      });
    });

    /**
     * ⚠️ L'adresse voyage avec les réglages, mais **facultative** : c'est ce
     * qui garde `org.billing` distincte de `org.settings` dans une seule
     * requête. Absente, elle n'est pas touchée ; présente, elle exige la clé.
     */
    it("keeps org.billing meaningful inside a single update", async () => {
      const admin = await memberWithRole("facturier", "admin");

      assert.equal(
        (await call(`/api/organizations/${organizationId}/billing`, admin)).status,
        403,
        "lire est gardé comme écrire : la clé dit la même chose des deux côtés",
      );

      const settings = { name: "Acme", description: "" };

      const saved = await call(`/api/organizations/${organizationId}`, owner, {
        method: "PUT",
        body: JSON.stringify({ ...settings, billingAddress: "  12 rue des Lilas  " }),
      });
      assert.equal(saved.status, 200);
      assert.deepEqual(
        await (
          await call(`/api/organizations/${organizationId}/billing`, owner)
        ).json(),
        { billingAddress: "12 rue des Lilas" },
        "l'adresse est rognée avant d'être écrite",
      );

      await call(`/api/organizations/${organizationId}`, owner, {
        method: "PUT",
        body: JSON.stringify({ ...settings, billingAddress: "   " }),
      });
      assert.deepEqual(
        await (
          await call(`/api/organizations/${organizationId}/billing`, owner)
        ).json(),
        { billingAddress: null },
        "une adresse blanche est absente, pas une chaîne d'espaces",
      );

      // Le champ omis ne touche à rien — sans quoi enregistrer un nom
      // effacerait l'adresse de celui qui n'a pas la clé pour la voir.
      await call(`/api/organizations/${organizationId}`, owner, {
        method: "PUT",
        body: JSON.stringify({ ...settings, billingAddress: "9 rue Neuve" }),
      });
      await call(`/api/organizations/${organizationId}`, owner, {
        method: "PUT",
        body: JSON.stringify(settings),
      });
      assert.deepEqual(
        await (
          await call(`/api/organizations/${organizationId}/billing`, owner)
        ).json(),
        { billingAddress: "9 rue Neuve" },
        "absente veut dire inchangée",
      );
    });

    /**
     * ⚠️ **Le défaut que `reachesProject` répare.** La visibilité d'un projet
     * passait par `can(actor, content.read, id)`, dont seule la moitié
     * « portée » servait — les six rôles système détiennent tous
     * `content.read`. Dès qu'un rôle personnalisé s'en passait, il ne voyait
     * aucun projet et prenait 404 sur chacun : donc jamais l'écran de clés
     * pour lequel il avait été créé.
     */
    it("lets a role without content.read reach the projects it administers", async () => {
      const created = await call(`/api/organizations/${organizationId}/roles`, owner, {
        method: "POST",
        body: JSON.stringify({
          name: "integrations",
          scope: "organization",
          // Gère les clés, ne lit rien. Un rôle plausible, et le cas qui
          // cassait.
          permissions: ["apikey.manage"],
        }),
      });
      assert.equal(created.status, 201);
      const { id: roleId } = (await created.json()) as { id: string };

      const integrator = await signUp("integrateur");
      sessions.push(integrator);
      await withContext({ userId: owner.userId, organizationId }, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId,
          userId: integrator.userId,
          roleId,
        }),
      );

      const project = await call(
        `/api/organizations/${organizationId}/projects`,
        owner,
        { method: "POST", body: JSON.stringify({ name: "Intégrations" }) },
      );
      const { id: projectId } = (await project.json()) as { id: string };

      const list = await call(
        `/api/organizations/${organizationId}/projects`,
        integrator,
      );
      assert.ok(
        ((await list.json()) as { id: string }[]).some((p) => p.id === projectId),
        "voir un projet est une question de portée, pas de `content.read`",
      );

      const one = await call(
        `/api/organizations/${organizationId}/projects/${projectId}`,
        integrator,
      );
      assert.equal(one.status, 200, "et l'ouvrir aussi");

      await call(`/api/organizations/${organizationId}/projects/${projectId}`, owner, {
        method: "DELETE",
      });
    });

    it("refuses a viewer, who holds neither org.settings nor project.delete", async () => {
      const response = await call(`/api/organizations/${organizationId}`, viewer, {
        method: "PUT",
        body: JSON.stringify({ name: "Détournée", description: "" }),
      });
      assert.equal(response.status, 403);
    });

    /**
     * The documented rule only named project members. Active keys block too:
     * deleting the project cascades to its environments and then to their
     * keys, so one still in circulation would die inside someone's production
     * site, silently.
     */
    it("refuses to delete a project while a key still opens it", async () => {
      const created = await call(
        `/api/organizations/${organizationId}/projects`,
        owner,
        { method: "POST", body: JSON.stringify({ name: "Porteur" }) },
      );
      const { id } = (await created.json()) as { id: string };
      const keys = `/api/organizations/${organizationId}/projects/${id}/api-keys`;

      const key = await call(keys, owner, {
        method: "POST",
        body: JSON.stringify({ kind: "public", name: "Site" }),
      });
      const { id: keyId } = (await key.json()) as { id: string };

      const blocked = await call(
        `/api/organizations/${organizationId}/projects/${id}`,
        owner,
        { method: "DELETE" },
      );
      assert.equal(blocked.status, 409);
      assert.equal(
        ((await blocked.json()) as { reason: string }).reason,
        "has_active_keys",
      );

      // Revoked keys do not block: they open nothing, and they stay as a trail.
      await call(`${keys}/${keyId}/revoke`, owner, { method: "POST" });
      assert.equal(
        (
          await call(`/api/organizations/${organizationId}/projects/${id}`, owner, {
            method: "DELETE",
          })
        ).status,
        204,
      );
    });

    it("empties an organization before deleting it", async () => {
      const solo = await signUp("solo");
      sessions.push(solo);
      const created = await call("/api/organizations", solo, {
        method: "POST",
        body: JSON.stringify({ name: "À supprimer" }),
      });
      const { id: orgId } = (await created.json()) as { id: string };

      const project = await call(`/api/organizations/${orgId}/projects`, solo, {
        method: "POST",
        body: JSON.stringify({ name: "Encore là" }),
      });
      const { id: projectId } = (await project.json()) as { id: string };

      const held = await call(`/api/organizations/${orgId}`, solo, {
        method: "DELETE",
      });
      assert.equal(held.status, 409);
      assert.equal(((await held.json()) as { reason: string }).reason, "has_projects");

      await call(`/api/organizations/${orgId}/projects/${projectId}`, solo, {
        method: "DELETE",
      });
      assert.equal(
        (await call(`/api/organizations/${orgId}`, solo, { method: "DELETE" })).status,
        204,
      );
      assert.equal(
        (await call(`/api/organizations/${orgId}/me`, solo)).status,
        404,
        "elle n'existe plus, donc elle est indiscernable d'inexistante",
      );
    });
  });

  describe("rôles personnalisés", () => {
    const rolesUrl = () => `/api/organizations/${organizationId}/roles`;

    it("serves the catalogue the console cannot otherwise know", async () => {
      const response = await call("/api/permissions", viewer);
      assert.equal(response.status, 200);

      const list = (await response.json()) as { key: string; description: string }[];
      assert.ok(list.some((p) => p.key === "content.publish"));
      assert.ok(
        list.every((p) => p.description.length > 0),
        "each key carries the label the console shows beside its checkbox",
      );
    });

    it("shows what every role grants, system ones included", async () => {
      const list = (await (await call(rolesUrl(), owner)).json()) as {
        name: string;
        isSystem: boolean;
        permissions: string[];
        holders: number;
      }[];

      const admin = list.find((r) => r.name === "admin");
      assert.ok(admin?.isSystem);
      assert.ok(
        admin.permissions.includes("member.manage"),
        "readable, so one can compare before composing",
      );
      assert.ok(
        !admin.permissions.includes("role.manage"),
        "an admin no longer defines what a role means (ADR 0014)",
      );

      assert.ok(
        (list.find((r) => r.name === "owner")?.holders ?? 0) >= 1,
        "the count is what stops someone editing a role blind",
      );
    });

    it("refuses an admin, and lets the owner through", async () => {
      const admin = await signUp("role-admin");
      sessions.push(admin);
      await withContext({ userId: owner.userId, organizationId }, async (tx) => {
        const [role] = await tx
          .select()
          .from(roles)
          .where(
            and(eq(roles.organizationId, organizationId), eq(roles.name, "admin")),
          );
        assert.ok(role);
        await tx
          .insert(organizationMembers)
          .values({ organizationId, userId: admin.userId, roleId: role.id });
      });

      const body = JSON.stringify({
        name: "Relecture",
        scope: "organization",
        permissions: ["content.read"],
      });

      const refused = await call(rolesUrl(), admin, { method: "POST", body });
      assert.equal(refused.status, 403);
      assert.equal(
        ((await refused.json()) as { reason: string }).reason,
        "missing_permission",
      );

      assert.equal(
        (await call(rolesUrl(), owner, { method: "POST", body })).status,
        201,
      );
    });

    it("refuses to grant beyond what the caller holds", async () => {
      // The owner holds everything, so the escalation rule needs a delegate to
      // have a subject — which is exactly how delegation is meant to work.
      const delegate = await signUp("role-delegate");
      sessions.push(delegate);

      const created = await call(rolesUrl(), owner, {
        method: "POST",
        body: JSON.stringify({
          name: "Gardien des rôles",
          scope: "organization",
          permissions: ["role.manage", "content.read"],
        }),
      });
      const { id: keeperRoleId } = (await created.json()) as { id: string };
      await withContext({ userId: owner.userId, organizationId }, (tx) =>
        tx.insert(organizationMembers).values({
          organizationId,
          userId: delegate.userId,
          roleId: keeperRoleId,
        }),
      );

      const overreach = await call(rolesUrl(), delegate, {
        method: "POST",
        body: JSON.stringify({
          name: "Trop puissant",
          scope: "organization",
          permissions: ["org.delete"],
        }),
      });
      assert.equal(overreach.status, 403);
      assert.equal(
        ((await overreach.json()) as { reason: string }).reason,
        "escalation",
      );
    });

    it("keeps system roles frozen", async () => {
      const list = (await (await call(rolesUrl(), owner)).json()) as {
        id: string;
        name: string;
      }[];
      const viewerRole = list.find((r) => r.name === "viewer");
      assert.ok(viewerRole);

      for (const [method, body] of [
        ["PUT", JSON.stringify({ name: "Renommé", permissions: [] })],
        ["DELETE", undefined],
      ] as const) {
        const response = await call(`${rolesUrl()}/${viewerRole.id}`, owner, {
          method,
          ...(body ? { body } : {}),
        });
        assert.equal(response.status, 409, method);
        assert.equal(
          ((await response.json()) as { reason: string }).reason,
          "system_role",
        );
      }
    });

    it("empties a role before deleting it", async () => {
      const created = await call(rolesUrl(), owner, {
        method: "POST",
        body: JSON.stringify({
          name: "Éphémère",
          scope: "organization",
          permissions: ["content.read"],
        }),
      });
      const { id } = (await created.json()) as { id: string };

      const wearer = await signUp("porteur");
      sessions.push(wearer);
      await withContext({ userId: owner.userId, organizationId }, (tx) =>
        tx
          .insert(organizationMembers)
          .values({ organizationId, userId: wearer.userId, roleId: id }),
      );

      const held = await call(`${rolesUrl()}/${id}`, owner, { method: "DELETE" });
      assert.equal(held.status, 409, "nothing is deleted while something points at it");
      assert.equal(((await held.json()) as { reason: string }).reason, "role_in_use");

      await call(
        `/api/organizations/${organizationId}/members/${wearer.userId}`,
        owner,
        { method: "DELETE" },
      );
      assert.equal(
        (await call(`${rolesUrl()}/${id}`, owner, { method: "DELETE" })).status,
        204,
      );
    });

    it("refuses two roles of one scope sharing a name", async () => {
      const body = JSON.stringify({
        name: "Doublon",
        scope: "organization",
        permissions: [],
      });
      assert.equal(
        (await call(rolesUrl(), owner, { method: "POST", body })).status,
        201,
      );

      const again = await call(rolesUrl(), owner, { method: "POST", body });
      assert.equal(again.status, 409);
      assert.equal(
        ((await again.json()) as { reason: string }).reason,
        "duplicate_name",
        "the unique constraint, said in a sentence rather than a 500",
      );
    });
  });

  describe("clés API", () => {
    let projectId = "";
    const base = () =>
      `/api/organizations/${organizationId}/projects/${projectId}/api-keys`;

    before(async () => {
      const response = await call(
        `/api/organizations/${organizationId}/projects`,
        owner,
        { method: "POST", body: JSON.stringify({ name: "Porteur de clés" }) },
      );
      projectId = ((await response.json()) as { id: string }).id;
    });

    const create = (kind: string, name: string) =>
      call(base(), owner, { method: "POST", body: JSON.stringify({ kind, name }) });

    it("crée une clé sans que la console nomme d'environnement", async () => {
      const response = await create("public", "Site web");
      assert.equal(response.status, 201);

      const { token } = (await response.json()) as { id: string; token: string };
      assert.ok(token.startsWith("pk_"), "le préfixe dit le type");
    });

    /**
     * Le cœur du choix de la liste nommée : plusieurs clés d'un même type,
     * pour remplacer sans coupure — créer, déployer, puis révoquer.
     */
    it("accepte plusieurs clés du même type", async () => {
      assert.equal((await create("public", "Deuxième site")).status, 201);

      const list = (await (await call(base(), owner)).json()) as { name: string }[];
      const publics = list.filter(
        (k) => k.name.startsWith("Site") || k.name.startsWith("Deuxième"),
      );
      assert.equal(publics.length, 2);
    });

    it("ne renvoie en clair que ce qui est stocké en clair", async () => {
      await create("secret", "Script de migration");
      const list = (await (await call(base(), owner)).json()) as {
        kind: string;
        token: string | null;
        hint: string;
      }[];

      const secret = list.find((k) => k.kind === "secret");
      assert.ok(secret);
      assert.equal(secret.token, null, "une secrète n'est jamais reconsultable");
      assert.ok(secret.hint.startsWith("sk_"), "seul son préfixe reste");

      assert.ok(list.find((k) => k.kind === "public")?.token?.startsWith("pk_"));
    });

    it("exige la révocation avant la suppression", async () => {
      const { id } = (await (await create("preview", "Éphémère")).json()) as {
        id: string;
      };

      const tooSoon = await call(`${base()}/${id}`, owner, { method: "DELETE" });
      assert.equal(
        tooSoon.status,
        409,
        "sans ce refus, une clé disparaîtrait sans qu'on sache si elle circulait",
      );
      assert.equal(
        ((await tooSoon.json()) as { reason: string }).reason,
        "not_revoked",
      );

      assert.equal(
        (await call(`${base()}/${id}/revoke`, owner, { method: "POST" })).status,
        204,
      );

      // Révoquée mais toujours listée : c'est la trace de ce qui a circulé.
      const listed = (await (await call(base(), owner)).json()) as {
        id: string;
        revokedAt: string | null;
      }[];
      assert.ok(listed.find((k) => k.id === id)?.revokedAt);

      assert.equal(
        (await call(`${base()}/${id}`, owner, { method: "DELETE" })).status,
        204,
      );
      const after = (await (await call(base(), owner)).json()) as { id: string }[];
      assert.ok(!after.some((k) => k.id === id));
    });

    it("refuse un viewer, qui ne gère pas les clés", async () => {
      const response = await call(base(), viewer);
      assert.equal(response.status, 403, "il voit le projet : rien de plus à cacher");
      assert.equal(
        ((await response.json()) as { reason: string }).reason,
        "missing_permission",
      );
    });

    it("répond 404 sur un projet d'une autre organization", async () => {
      const response = await call(
        `/api/organizations/${organizationId}/projects/${randomUUID()}/api-keys`,
        owner,
      );
      assert.equal(response.status, 404);
    });
  });

  it("expose les routes dans la spec OpenAPI", async () => {
    const response = await app.request("/openapi.json");
    const spec = (await response.json()) as { paths: Record<string, unknown> };
    assert.ok(spec.paths["/api/organizations"]);
    assert.ok(spec.paths["/api/organizations/{organizationId}/projects"]);
  });

  /**
   * Régression du cas rencontré en éprouvant la console : se connecter
   * directement, sans passer par le lien de l'email, laissait une invitation
   * réelle invisible. `/api/inbox` retrouve par l'adresse de la session
   * vérifiée, jamais par une valeur envoyée par le client.
   */
  describe("Inbox", () => {
    it("montre une invitation en attente, l'accepte, puis n'en montre plus rien", async () => {
      const [viewerRole] = await withContext(
        { userId: owner.userId, organizationId },
        (tx) =>
          tx
            .select()
            .from(roles)
            .where(
              and(eq(roles.organizationId, organizationId), eq(roles.name, "viewer")),
            ),
      );
      assert.ok(viewerRole);

      const invited = await call(
        `/api/organizations/${organizationId}/invitations`,
        owner,
        {
          method: "POST",
          body: JSON.stringify({ email: outsider.email, roleId: viewerRole.id }),
        },
      );
      assert.equal(invited.status, 201);

      const before = await call("/api/inbox", outsider);
      assert.equal(before.status, 200);
      const pending = (await before.json()) as {
        id: string;
        organizationName: string;
      }[];
      assert.equal(pending.length, 1);
      assert.equal(pending[0]?.organizationName, "Acme");

      const accepted = await call(`/api/inbox/${pending[0]?.id}/accept`, outsider, {
        method: "POST",
      });
      assert.equal(accepted.status, 200);
      assert.equal(
        ((await accepted.json()) as { organizationId: string }).organizationId,
        organizationId,
      );

      const after = await call("/api/inbox", outsider);
      assert.deepEqual(await after.json(), []);

      // L'outsider est devenu membre — retiré ici pour ne pas fausser les
      // autres tests de ce fichier, qui le supposent extérieur à Acme.
      await withContext({ userId: owner.userId, organizationId }, (tx) =>
        tx
          .delete(organizationMembers)
          .where(
            and(
              eq(organizationMembers.organizationId, organizationId),
              eq(organizationMembers.userId, outsider.userId),
            ),
          ),
      );
    });

    it("ne montre rien sans session", async () => {
      const response = await app.request("/api/inbox");
      assert.equal(response.status, 401);
    });
  });
});
