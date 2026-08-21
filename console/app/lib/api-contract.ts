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
  PostApiInboxInvitationIdAcceptResponse,
  PostApiInvitationsTokenAcceptResponse,
  PostApiOrganizationsBody,
  PostApiOrganizationsOrganizationIdInvitationsBody,
  PostApiOrganizationsOrganizationIdInvitationsResponse,
  PostApiOrganizationsOrganizationIdProjectsBody,
  PostApiOrganizationsOrganizationIdProjectsProjectIdInvitationsBody,
  PostApiOrganizationsOrganizationIdProjectsProjectIdInvitationsResponse,
  PostApiOrganizationsOrganizationIdProjectsResponse,
  PostApiOrganizationsResponse,
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

export const MembershipSchema = GetApiOrganizationsOrganizationIdMeResponse;
export type Membership = z.infer<typeof GetApiOrganizationsOrganizationIdMeResponse>;

export const MembersSchema = GetApiOrganizationsOrganizationIdMembersResponse;
export type Member = z.infer<
  typeof GetApiOrganizationsOrganizationIdMembersResponseItem
>;

export const RolesSchema = GetApiOrganizationsOrganizationIdRolesResponse;
export type Role = z.infer<typeof GetApiOrganizationsOrganizationIdRolesResponseItem>;

export const PendingInvitationsSchema =
  GetApiOrganizationsOrganizationIdInvitationsResponse;
export type PendingInvitation = z.infer<
  typeof GetApiOrganizationsOrganizationIdInvitationsResponseItem
>;

export const NewInvitationSchema = PostApiOrganizationsOrganizationIdInvitationsBody;

/** Ce que renvoie l'envoi d'une invitation : son identifiant, rien d'autre. */
export const SentInvitationSchema =
  PostApiOrganizationsOrganizationIdInvitationsResponse;

export const ReceivedInvitationsSchema = GetApiInboxResponse;
export type ReceivedInvitation = z.infer<typeof GetApiInboxResponseItem>;

export const InvitationDescriptionSchema = GetApiInvitationsTokenResponse;
export type InvitationDescription = z.infer<typeof GetApiInvitationsTokenResponse>;

/** Les deux chemins d'acceptation — par jeton, ou depuis l'Inbox. */
export const AcceptedByTokenSchema = PostApiInvitationsTokenAcceptResponse;
export const AcceptedFromInboxSchema = PostApiInboxInvitationIdAcceptResponse;
