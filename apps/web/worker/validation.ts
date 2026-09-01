import {
  analyticsNextActionsQuerySchema,
  analyticsOverdueTasksQuerySchema,
  analyticsOverviewQuerySchema,
  analyticsStaleApplicationsQuerySchema,
  applicationStatusSchema,
  candidateProfileSchema,
  safeSourceUrlSchema,
} from "@upgradr/contracts";
import { z } from "zod";

import { activityEntityTypes } from "./activity";
import { ACCOUNT_DELETION_CONFIRMATION_PHRASE } from "../shared/account";
import { DOCUMENT_KINDS, DOCUMENT_LINK_ROLES } from "../shared/documents";
import { PROFILE_IMPORT_PREVIEW_LIMITS, profileImportCreateSchema } from "../shared/profileImportPreview";

export { profileImportCreateSchema };

export {
  analyticsNextActionsQuerySchema,
  analyticsOverdueTasksQuerySchema,
  analyticsOverviewQuerySchema,
  analyticsStaleApplicationsQuerySchema,
};

export const applicationIdSchema = z.uuid();

// Generic UUID path-parameter validator shared by the companies, contacts,
// and notes routes.
export const uuidParamSchema = z.uuid();

// Mirrors the public.activity_events.entity_type check constraint (see
// ./activity.ts, the single source of truth for the entity type list).
export const activityEntityTypeSchema = z.enum(activityEntityTypes);

export const magicLinkSchema = z.object({
  email: z.email().max(320),
  returnTo: z
    .string()
    .max(2_000)
    .refine((value) => value.startsWith("/") && !value.startsWith("//"))
    .optional(),
});

export const statusTransitionSchema = z.object({
  status: applicationStatusSchema,
  note: z.string().trim().max(2_000).optional(),
});

export const oauthDecisionSchema = z.object({
  authorizationId: z.string().min(1).max(2_000),
  decision: z.enum(["approve", "deny"]),
});

export const oauthRevokeSchema = z.object({
  clientId: z.uuid(),
});

// Reuses the same field-level rules as the shared candidate profile
// contract so headline/summary edits stay consistent with imported data.
export const profileUpdateSchema = candidateProfileSchema.pick({
  headline: true,
  summary: true,
});

// Selections passed to POST /api/profile/imports/:id/confirm, forwarded
// directly to public.confirm_profile_import() as its p_experience_indexes /
// p_education_indexes / p_skill_indexes / p_confirm_profile arguments. The
// bound matches PROFILE_IMPORT_PREVIEW_LIMITS.maxItemsPerCategory so a
// client can never request more items than the stored raw_payload could
// possibly contain; the database function re-validates each index against
// the actual payload regardless.
export const profileImportConfirmSchema = z.object({
  confirmProfile: z.boolean().optional().default(false),
  experienceIndexes: z
    .array(z.number().int().min(0))
    .max(PROFILE_IMPORT_PREVIEW_LIMITS.maxItemsPerCategory)
    .optional()
    .default([]),
  educationIndexes: z
    .array(z.number().int().min(0))
    .max(PROFILE_IMPORT_PREVIEW_LIMITS.maxItemsPerCategory)
    .optional()
    .default([]),
  skillIndexes: z
    .array(z.number().int().min(0))
    .max(PROFILE_IMPORT_PREVIEW_LIMITS.maxItemsPerCategory)
    .optional()
    .default([]),
});

export const taskCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(4_000).nullable().optional(),
  dueAt: z.iso.datetime().nullable().optional(),
  applicationId: z.uuid().nullable().optional(),
});

export const taskUpdateSchema = z.object({
  isCompleted: z.boolean(),
});

export const companyCreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  websiteUrl: safeSourceUrlSchema.nullable().optional(),
  industry: z.string().trim().max(120).nullable().optional(),
  sizeRange: z.string().trim().max(60).nullable().optional(),
  notes: z.string().trim().max(4_000).nullable().optional(),
});

export const companyUpdateSchema = companyCreateSchema.partial();

export const contactCreateSchema = z.object({
  fullName: z.string().trim().min(1).max(200),
  companyId: z.uuid().nullable().optional(),
  roleTitle: z.string().trim().max(200).nullable().optional(),
  email: z.email().max(320).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  linkedinUrl: safeSourceUrlSchema.nullable().optional(),
  notes: z.string().trim().max(4_000).nullable().optional(),
});

export const contactUpdateSchema = contactCreateSchema.partial();

export const noteCreateSchema = z.object({
  body: z.string().trim().min(1).max(8_000),
  applicationId: z.uuid().nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  contactId: z.uuid().nullable().optional(),
});

export const noteUpdateSchema = z.object({
  body: z.string().trim().min(1).max(8_000),
});

// Mirrors the public.labels.name / .color check constraints (see
// supabase/migrations/20250115121600_manual_labels.sql).
const labelColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, "Label color must be a 6-digit hex code, e.g. #7b61ff")
  .nullable();

export const labelCreateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: labelColorSchema.optional(),
});

export const labelUpdateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  color: labelColorSchema.optional(),
});

export const applicationLabelAttachSchema = z.object({
  labelId: z.uuid(),
});

// Mirrors the public.documents.kind and public.application_documents.role
// check constraints (see ../shared/documents.ts, the single source of truth
// for these enums).
export const documentKindSchema = z.enum(DOCUMENT_KINDS);
export const documentLinkRoleSchema = z.enum(DOCUMENT_LINK_ROLES);

export const documentLinkCreateSchema = z.object({
  applicationId: z.uuid(),
  role: documentLinkRoleSchema.optional(),
});

// Requires the literal, case-sensitive confirmation phrase (see
// ../shared/account.ts, the single source of truth reused by the DELETE
// /api/account handler and the AccountTab confirmation input) so a
// malformed or partially-typed request can never be accepted as consent to
// permanently delete the account.
export const accountDeletionSchema = z.object({
  confirmation: z.literal(ACCOUNT_DELETION_CONFIRMATION_PHRASE),
});
