import { z } from "zod";

/**
 * The kinds of thing a user can ask never to be shown again.
 *
 * Two identify one specific posting and two describe a pattern. That split
 * decides how long a rule lives (see suppressionExpiresByDefault) and how it is
 * presented, so it is expressed once here and shared by the database check
 * constraint, the web API, and the UI.
 */
export const suppressionKeyTypes = [
  "canonical_url",
  "provider_external_id",
  "fingerprint",
  "company",
] as const;

export type SuppressionKeyType = (typeof suppressionKeyTypes)[number];

export const suppressionKeyTypeLabels: Record<SuppressionKeyType, string> = {
  canonical_url: "Job posting",
  provider_external_id: "Job posting",
  fingerprint: "Similar roles",
  company: "Company",
};

/**
 * Whether a rule of this type lapses on its own.
 *
 * A specific posting the user rejected is permanent, because it will never
 * become interesting again. Pattern rules expire, because "not right now" is a
 * far more common intent than "never again" at that breadth, and a silently
 * permanent company mute is a trap: the user would have to remember a decision
 * they made months ago to understand why nothing from that employer appears.
 */
export function suppressionExpiresByDefault(keyType: SuppressionKeyType): boolean {
  return keyType === "fingerprint" || keyType === "company";
}

export const suppressionSourceLabels = {
  auto_closed: "Added when you closed an opportunity",
  manual: "Added by you",
} as const;

export type SuppressionSource = keyof typeof suppressionSourceLabels;

/**
 * Only company and fingerprint rules can be created by hand.
 *
 * Posting-level rules are seeded automatically when an opportunity is closed as
 * a rejection, so offering a form that asks a user to paste a canonical URL
 * would be a worse route to the same result.
 */
export const createSuppressionSchema = z.object({
  keyType: z.enum(["company", "fingerprint"]),
  keyValue: z.string().trim().min(1).max(500),
  reason: z.string().trim().min(1).max(500).optional(),
});

export type CreateSuppressionInput = z.infer<typeof createSuppressionSchema>;
