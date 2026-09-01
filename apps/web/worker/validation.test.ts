import { describe, expect, it } from "vitest";

import { ACCOUNT_DELETION_CONFIRMATION_PHRASE } from "../shared/account";
import {
  accountDeletionSchema,
  activityEntityTypeSchema,
  applicationIdSchema,
  applicationLabelAttachSchema,
  companyCreateSchema,
  companyUpdateSchema,
  contactCreateSchema,
  contactUpdateSchema,
  documentKindSchema,
  documentLinkCreateSchema,
  labelCreateSchema,
  labelUpdateSchema,
  magicLinkSchema,
  noteCreateSchema,
  noteUpdateSchema,
  oauthRevokeSchema,
  profileImportConfirmSchema,
  profileUpdateSchema,
  statusTransitionSchema,
  taskCreateSchema,
  taskUpdateSchema,
  uuidParamSchema,
} from "./validation";

describe("applicationIdSchema", () => {
  it("accepts only UUID application identifiers", () => {
    expect(applicationIdSchema.safeParse("5b3f3d3a-7f0a-4b8d-9d4a-2f6b6b6b6b6b").success).toBe(
      true,
    );
    expect(applicationIdSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("magicLinkSchema", () => {
  it("accepts a bare email with no returnTo", () => {
    expect(magicLinkSchema.safeParse({ email: "person@example.com" }).success).toBe(true);
  });

  it("rejects protocol-relative returnTo (open redirect)", () => {
    expect(
      magicLinkSchema.safeParse({ email: "person@example.com", returnTo: "//evil.example" })
        .success,
    ).toBe(false);
  });

  it("rejects returnTo values that are not app-relative paths", () => {
    expect(
      magicLinkSchema.safeParse({
        email: "person@example.com",
        returnTo: "https://evil.example",
      }).success,
    ).toBe(false);
  });
});

describe("statusTransitionSchema", () => {
  it("accepts a known status with an optional note", () => {
    expect(statusTransitionSchema.safeParse({ status: "applied", note: "Applied via referral" }).success).toBe(
      true,
    );
  });

  it("rejects unknown statuses", () => {
    expect(statusTransitionSchema.safeParse({ status: "ghosted" }).success).toBe(false);
  });
});

describe("profileUpdateSchema", () => {
  it("accepts a headline and summary", () => {
    expect(
      profileUpdateSchema.safeParse({
        headline: "Senior iOS Engineer",
        summary: "Ten years building mobile apps.",
      }).success,
    ).toBe(true);
  });

  it("allows clearing fields with null", () => {
    expect(profileUpdateSchema.safeParse({ headline: null, summary: null }).success).toBe(true);
  });

  it("rejects an overlong headline", () => {
    expect(
      profileUpdateSchema.safeParse({ headline: "x".repeat(241), summary: null }).success,
    ).toBe(false);
  });
});

describe("profileImportConfirmSchema", () => {
  it("defaults every field when given an empty object", () => {
    const parsed = profileImportConfirmSchema.safeParse({});
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        confirmProfile: false,
        experienceIndexes: [],
        educationIndexes: [],
        skillIndexes: [],
      });
    }
  });

  it("accepts explicit index selections", () => {
    expect(
      profileImportConfirmSchema.safeParse({
        confirmProfile: true,
        experienceIndexes: [0, 2],
        educationIndexes: [1],
        skillIndexes: [0, 1, 3],
      }).success,
    ).toBe(true);
  });

  it("rejects negative indexes", () => {
    expect(profileImportConfirmSchema.safeParse({ experienceIndexes: [-1] }).success).toBe(false);
  });

  it("rejects non-integer indexes", () => {
    expect(profileImportConfirmSchema.safeParse({ skillIndexes: [1.5] }).success).toBe(false);
  });

  it("rejects more indexes than the preview item cap allows", () => {
    const tooMany = Array.from({ length: 201 }, (_, index) => index);
    expect(profileImportConfirmSchema.safeParse({ experienceIndexes: tooMany }).success).toBe(
      false,
    );
  });
});

describe("taskCreateSchema", () => {
  it("accepts a minimal task with just a title", () => {
    expect(taskCreateSchema.safeParse({ title: "Follow up with recruiter" }).success).toBe(true);
  });

  it("rejects a blank title", () => {
    expect(taskCreateSchema.safeParse({ title: "   " }).success).toBe(false);
  });

  it("rejects a non-ISO dueAt", () => {
    expect(
      taskCreateSchema.safeParse({ title: "Follow up", dueAt: "next tuesday" }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid applicationId", () => {
    expect(
      taskCreateSchema.safeParse({ title: "Follow up", applicationId: "not-a-uuid" }).success,
    ).toBe(false);
  });
});

describe("taskUpdateSchema", () => {
  it("requires an explicit completion boolean", () => {
    expect(taskUpdateSchema.safeParse({ isCompleted: true }).success).toBe(true);
    expect(taskUpdateSchema.safeParse({}).success).toBe(false);
  });
});

describe("oauthRevokeSchema", () => {
  it("requires a uuid client id", () => {
    expect(oauthRevokeSchema.safeParse({ clientId: "123" }).success).toBe(false);
    expect(
      oauthRevokeSchema.safeParse({ clientId: "5b3f3d3a-7f0a-4b8d-9d4a-2f6b6b6b6b6b" }).success,
    ).toBe(true);
  });
});

describe("documentKindSchema", () => {
  it("accepts every known document kind", () => {
    for (const kind of ["resume", "cover_letter", "portfolio", "transcript", "offer_letter", "other"]) {
      expect(documentKindSchema.safeParse(kind).success).toBe(true);
    }
  });

  it("rejects an unknown kind", () => {
    expect(documentKindSchema.safeParse("headshot").success).toBe(false);
  });
});

describe("documentLinkCreateSchema", () => {
  it("accepts a uuid applicationId with an optional role", () => {
    expect(
      documentLinkCreateSchema.safeParse({
        applicationId: "5b3f3d3a-7f0a-4b8d-9d4a-2f6b6b6b6b6b",
        role: "resume",
      }).success,
    ).toBe(true);
  });

  it("defaults role to optional so the API can fall back to 'attachment'", () => {
    expect(
      documentLinkCreateSchema.safeParse({
        applicationId: "5b3f3d3a-7f0a-4b8d-9d4a-2f6b6b6b6b6b",
      }).success,
    ).toBe(true);
  });

  it("rejects a non-uuid applicationId", () => {
    expect(documentLinkCreateSchema.safeParse({ applicationId: "not-a-uuid" }).success).toBe(
      false,
    );
  });

  it("rejects an unknown role", () => {
    expect(
      documentLinkCreateSchema.safeParse({
        applicationId: "5b3f3d3a-7f0a-4b8d-9d4a-2f6b6b6b6b6b",
        role: "headshot",
      }).success,
    ).toBe(false);
  });
});

describe("uuidParamSchema", () => {
  it("accepts only well-formed UUIDs", () => {
    expect(uuidParamSchema.safeParse("5b3f3d3a-7f0a-4b8d-9d4a-2f6b6b6b6b6b").success).toBe(true);
    expect(uuidParamSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

describe("activityEntityTypeSchema", () => {
  it("accepts every known entity type", () => {
    for (const entityType of [
      "application",
      "company",
      "contact",
      "task",
      "note",
      "document",
      "candidate_profile",
      "profile_import",
      "mcp_operation",
    ]) {
      expect(activityEntityTypeSchema.safeParse(entityType).success).toBe(true);
    }
  });

  it("rejects an unknown entity type", () => {
    expect(activityEntityTypeSchema.safeParse("widget").success).toBe(false);
  });
});

describe("companyCreateSchema", () => {
  it("accepts a minimal company with just a name", () => {
    expect(companyCreateSchema.safeParse({ name: "Acme Corp" }).success).toBe(true);
  });

  it("accepts a fully populated company", () => {
    expect(
      companyCreateSchema.safeParse({
        name: "Acme Corp",
        websiteUrl: "https://acme.example",
        industry: "Software",
        sizeRange: "51-200",
        notes: "Met the recruiter at a conference.",
      }).success,
    ).toBe(true);
  });

  it("rejects a blank name", () => {
    expect(companyCreateSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects a non-http(s) website URL", () => {
    expect(companyCreateSchema.safeParse({ name: "Acme", websiteUrl: "javascript:alert(1)" }).success).toBe(
      false,
    );
  });
});

describe("companyUpdateSchema", () => {
  it("allows a partial update of a single field", () => {
    expect(companyUpdateSchema.safeParse({ industry: "Fintech" }).success).toBe(true);
  });

  it("allows an empty update", () => {
    expect(companyUpdateSchema.safeParse({}).success).toBe(true);
  });
});

describe("contactCreateSchema", () => {
  it("accepts a minimal contact with just a name", () => {
    expect(contactCreateSchema.safeParse({ fullName: "Jamie Rivera" }).success).toBe(true);
  });

  it("rejects an invalid email", () => {
    expect(
      contactCreateSchema.safeParse({ fullName: "Jamie Rivera", email: "not-an-email" }).success,
    ).toBe(false);
  });

  it("rejects a non-uuid companyId", () => {
    expect(
      contactCreateSchema.safeParse({ fullName: "Jamie Rivera", companyId: "not-a-uuid" }).success,
    ).toBe(false);
  });
});

describe("contactUpdateSchema", () => {
  it("allows a partial update", () => {
    expect(contactUpdateSchema.safeParse({ roleTitle: "VP Engineering" }).success).toBe(true);
  });
});

describe("noteCreateSchema", () => {
  it("accepts a minimal note with just a body", () => {
    expect(noteCreateSchema.safeParse({ body: "Great conversation today." }).success).toBe(true);
  });

  it("rejects a blank body", () => {
    expect(noteCreateSchema.safeParse({ body: "   " }).success).toBe(false);
  });

  it("rejects an overlong body", () => {
    expect(noteCreateSchema.safeParse({ body: "x".repeat(8_001) }).success).toBe(false);
  });

  it("rejects a non-uuid companyId link", () => {
    expect(
      noteCreateSchema.safeParse({ body: "Note", companyId: "not-a-uuid" }).success,
    ).toBe(false);
  });
});

describe("noteUpdateSchema", () => {
  it("requires a non-empty body", () => {
    expect(noteUpdateSchema.safeParse({ body: "Updated note" }).success).toBe(true);
    expect(noteUpdateSchema.safeParse({ body: "" }).success).toBe(false);
  });
});

describe("accountDeletionSchema", () => {
  it("accepts the exact confirmation phrase", () => {
    expect(
      accountDeletionSchema.safeParse({ confirmation: ACCOUNT_DELETION_CONFIRMATION_PHRASE })
        .success,
    ).toBe(true);
  });

  it("rejects a case mismatch", () => {
    expect(
      accountDeletionSchema.safeParse({
        confirmation: ACCOUNT_DELETION_CONFIRMATION_PHRASE.toLowerCase(),
      }).success,
    ).toBe(false);
  });

  it("rejects a missing confirmation field", () => {
    expect(accountDeletionSchema.safeParse({}).success).toBe(false);
  });

  it("rejects any other free text, including near-matches", () => {
    expect(accountDeletionSchema.safeParse({ confirmation: "DELETE MY ACCOUNT!" }).success).toBe(
      false,
    );
    expect(accountDeletionSchema.safeParse({ confirmation: "yes" }).success).toBe(false);
  });
});

describe("labelCreateSchema", () => {
  it("accepts a minimal label with just a name", () => {
    expect(labelCreateSchema.safeParse({ name: "Remote" }).success).toBe(true);
  });

  it("accepts a name with a valid hex color", () => {
    expect(labelCreateSchema.safeParse({ name: "Priority", color: "#7b61ff" }).success).toBe(true);
  });

  it("rejects a blank name", () => {
    expect(labelCreateSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("rejects an overlong name", () => {
    expect(labelCreateSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
  });

  it("rejects a malformed color", () => {
    expect(labelCreateSchema.safeParse({ name: "Priority", color: "violet" }).success).toBe(false);
  });

  it("allows an explicit null color", () => {
    expect(labelCreateSchema.safeParse({ name: "Priority", color: null }).success).toBe(true);
  });
});

describe("labelUpdateSchema", () => {
  it("allows a partial rename", () => {
    expect(labelUpdateSchema.safeParse({ name: "Dream job" }).success).toBe(true);
  });

  it("allows an empty update", () => {
    expect(labelUpdateSchema.safeParse({}).success).toBe(true);
  });

  it("rejects a blank name when provided", () => {
    expect(labelUpdateSchema.safeParse({ name: "" }).success).toBe(false);
  });
});

describe("applicationLabelAttachSchema", () => {
  it("accepts a valid label id", () => {
    expect(
      applicationLabelAttachSchema.safeParse({ labelId: "5b3f3d3a-7f0a-4b8d-9d4a-2f6b6b6b6b6b" })
        .success,
    ).toBe(true);
  });

  it("rejects a non-uuid label id", () => {
    expect(applicationLabelAttachSchema.safeParse({ labelId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a missing label id", () => {
    expect(applicationLabelAttachSchema.safeParse({}).success).toBe(false);
  });
});
