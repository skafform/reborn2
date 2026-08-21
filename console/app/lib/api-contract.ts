import type * as z from "zod/mini";
import {
  GetApiInboxResponse,
  type GetApiInboxResponseItem,
  GetApiInvitationsTokenResponse,
  GetApiOrganizationsOrganizationIdInvitationsResponse,
  type GetApiOrganizationsOrganizationIdInvitationsResponseItem,
  GetApiOrganizationsOrganizationIdMembersResponse,
  type GetApiOrganizationsOrganizationIdMembersResponseItem,
  GetApiOrganizationsOrganizationIdMeResponse,
  GetApiOrganizationsOrganizationIdProjectsProjectIdApiKeysResponse,
  type GetApiOrganizationsOrganizationIdProjectsProjectIdApiKeysResponseItem,
  GetApiOrganizationsOrganizationIdProjectsProjectIdInvitationsResponse,
  GetApiOrganizationsOrganizationIdProjectsProjectIdMembersResponse,
  GetApiOrganizationsOrganizationIdProjectsProjectIdMeResponse,
  GetApiOrganizationsOrganizationIdProjectsProjectIdResponse,
  GetApiOrganizationsOrganizationIdProjectsResponse,
  type GetApiOrganizationsOrganizationIdProjectsResponseItem,
  GetApiOrganizationsOrganizationIdRolesResponse,
  type GetApiOrganizationsOrganizationIdRolesResponseItem,
  GetApiOrganizationsResponse,
  type GetApiOrganizationsResponseItem,
  GetApiPermissionsResponse,
  type GetApiPermissionsResponseItem,
  PostApiInboxInvitationIdAcceptResponse,
  PostApiInvitationsTokenAcceptResponse,
  PostApiOrganizationsBody,
  PostApiOrganizationsOrganizationIdInvitationsBody,
  PostApiOrganizationsOrganizationIdInvitationsResponse,
  PostApiOrganizationsOrganizationIdProjectsBody,
  PostApiOrganizationsOrganizationIdProjectsProjectIdApiKeysBody,
  PostApiOrganizationsOrganizationIdProjectsProjectIdApiKeysResponse,
  PostApiOrganizationsOrganizationIdProjectsProjectIdInvitationsBody,
  PostApiOrganizationsOrganizationIdProjectsProjectIdInvitationsResponse,
  PostApiOrganizationsOrganizationIdProjectsResponse,
  PostApiOrganizationsOrganizationIdRolesBody,
  PostApiOrganizationsOrganizationIdRolesResponse,
  PostApiOrganizationsResponse,
  PutApiOrganizationsOrganizationIdMembersUserIdRoleBody,
  PutApiOrganizationsOrganizationIdMembersUserIdSuspensionBody,
  PutApiOrganizationsOrganizationIdRolesRoleIdBody,
} from "./api-schemas";

/**
 * Le contrat de l'API, sous des noms lisibles.
 *
 * `api-schemas.ts` est **généré** et ses noms suivent la route
 * (`GetApiOrganizationsOrganizationIdMembersResponseItem`). Les répéter dans
 * chaque écran serait illisible, et les renommer à chaque appel reviendrait à
 * la recopie qu'on vient d'éliminer. Ce module les nomme **une fois**.
 *
 * ⚠️ **Rien ne se déclare ici** — que des alias. La forme vient du serveur,
 * jamais d'une supposition écrite à la main : c'est exactement ce qui dérivait
 * (voir docs/architecture/api.md).
 *
 * Les types viennent de `z.infer` : une seule source pour la validation **et**
 * pour le typage.
 *
 * Les schémas en `New…` décrivent ce qu'on **envoie**. Ils viennent du même
 * contrat que les réponses, et ferment la dérive dans l'autre sens.
 */

export const OrganizationsSchema = GetApiOrganizationsResponse;
export type Organization = z.infer<typeof GetApiOrganizationsResponseItem>;

export const NewOrganizationSchema = PostApiOrganizationsBody;
export const CreatedOrganizationSchema = PostApiOrganizationsResponse;
export type CreatedOrganization = z.infer<typeof PostApiOrganizationsResponse>;

export const ProjectsSchema = GetApiOrganizationsOrganizationIdProjectsResponse;
export type Project = z.infer<
  typeof GetApiOrganizationsOrganizationIdProjectsResponseItem
>;

export const NewProjectSchema = PostApiOrganizationsOrganizationIdProjectsBody;
export const CreatedProjectSchema = PostApiOrganizationsOrganizationIdProjectsResponse;

export const ProjectSchema = GetApiOrganizationsOrganizationIdProjectsProjectIdResponse;

/**
 * Ce qu'on peut faire **dans ce projet**. Jumeau de `MembershipSchema` : pour
 * une portée projet, `can()` exige la cible, donc la réponse dépend du projet
 * regardé.
 */
export const ProjectMembershipSchema =
  GetApiOrganizationsOrganizationIdProjectsProjectIdMeResponse;

export const ProjectMembersSchema =
  GetApiOrganizationsOrganizationIdProjectsProjectIdMembersResponse;

export const ProjectInvitationsSchema =
  GetApiOrganizationsOrganizationIdProjectsProjectIdInvitationsResponse;

export const NewProjectInvitationSchema =
  PostApiOrganizationsOrganizationIdProjectsProjectIdInvitationsBody;

export const SentProjectInvitationSchema =
  PostApiOrganizationsOrganizationIdProjectsProjectIdInvitationsResponse;

export const ApiKeysSchema =
  GetApiOrganizationsOrganizationIdProjectsProjectIdApiKeysResponse;
export type ApiKey = z.infer<
  typeof GetApiOrganizationsOrganizationIdProjectsProjectIdApiKeysResponseItem
>;

export const NewApiKeySchema =
  PostApiOrganizationsOrganizationIdProjectsProjectIdApiKeysBody;

/** Le jeton en clair — la seule fois qu'on le voit, pour une clé secrète. */
export const CreatedApiKeySchema =
  PostApiOrganizationsOrganizationIdProjectsProjectIdApiKeysResponse;

export const MembershipSchema = GetApiOrganizationsOrganizationIdMeResponse;
export type Membership = z.infer<typeof GetApiOrganizationsOrganizationIdMeResponse>;

export const MembersSchema = GetApiOrganizationsOrganizationIdMembersResponse;
export type Member = z.infer<
  typeof GetApiOrganizationsOrganizationIdMembersResponseItem
>;

export const RolesSchema = GetApiOrganizationsOrganizationIdRolesResponse;
export type Role = z.infer<typeof GetApiOrganizationsOrganizationIdRolesResponseItem>;

/**
 * Le vocabulaire de l'autorisation, que la console ne peut connaître
 * autrement : il vit en code côté serveur.
 */
export const PermissionCatalogueSchema = GetApiPermissionsResponse;
export type PermissionDescriptor = z.infer<typeof GetApiPermissionsResponseItem>;

export const NewRoleSchema = PostApiOrganizationsOrganizationIdRolesBody;
export const CreatedRoleSchema = PostApiOrganizationsOrganizationIdRolesResponse;
export const RoleEditSchema = PutApiOrganizationsOrganizationIdRolesRoleIdBody;

export const PendingInvitationsSchema =
  GetApiOrganizationsOrganizationIdInvitationsResponse;
export type PendingInvitation = z.infer<
  typeof GetApiOrganizationsOrganizationIdInvitationsResponseItem
>;

export const NewInvitationSchema = PostApiOrganizationsOrganizationIdInvitationsBody;

/** Ce que renvoie l'envoi d'une invitation : son identifiant, rien d'autre. */
export const SentInvitationSchema =
  PostApiOrganizationsOrganizationIdInvitationsResponse;

/**
 * Ce qu'on envoie pour changer une adhésion. Les deux mêmes corps servent au
 * niveau de l'organization et du projet — l'endroit vient de l'adresse.
 */
export const SuspensionSchema =
  PutApiOrganizationsOrganizationIdMembersUserIdSuspensionBody;
export const RoleChangeSchema = PutApiOrganizationsOrganizationIdMembersUserIdRoleBody;

export const ReceivedInvitationsSchema = GetApiInboxResponse;
export type ReceivedInvitation = z.infer<typeof GetApiInboxResponseItem>;

export const InvitationDescriptionSchema = GetApiInvitationsTokenResponse;
export type InvitationDescription = z.infer<typeof GetApiInvitationsTokenResponse>;

/** Les deux chemins d'acceptation — par jeton, ou depuis l'Inbox. */
export const AcceptedByTokenSchema = PostApiInvitationsTokenAcceptResponse;
export const AcceptedFromInboxSchema = PostApiInboxInvitationIdAcceptResponse;
