import { describe, expect, it } from "vitest";

import { importLinkedInExport } from "./index";

const POSITIONS_HEADER = "Company Name,Title,Description,Location,Started On,Finished On";
const EDUCATION_HEADER = "School Name,Start Date,End Date,Notes,Degree Name,Field Of Study";
const SKILLS_HEADER = "Name";
const PROFILE_HEADER = "First Name,Last Name,Headline,Summary";

describe("importLinkedInExport", () => {
  it("combines all four optional files into one preview", () => {
    const preview = importLinkedInExport({
      positions: {
        fileName: "Positions.csv",
        content: `${POSITIONS_HEADER}\nAcme,Engineer,,Remote,2020-01-15,\n`,
      },
      education: {
        fileName: "Education.csv",
        content: `${EDUCATION_HEADER}\nState University,2016,2020,,BSc,CS\n`,
      },
      skills: { fileName: "Skills.csv", content: `${SKILLS_HEADER}\nTypeScript\n` },
      profile: {
        fileName: "Profile.csv",
        content: `${PROFILE_HEADER}\nJane,Doe,Senior Engineer,Building things.\n`,
      },
    });

    expect(preview.filesMissing).toEqual([]);
    expect(preview.filesProcessed).toEqual([
      "Positions.csv",
      "Education.csv",
      "Skills.csv",
      "Profile.csv",
    ]);
    expect(preview.experiences).toHaveLength(1);
    expect(preview.education).toHaveLength(1);
    expect(preview.skills).toHaveLength(1);
    expect(preview.profile?.value.headline).toBe("Senior Engineer");
    expect(preview.experiences[0]?.confirmed).toBe(false);
    expect(preview.education[0]?.confirmed).toBe(false);
    expect(preview.skills[0]?.confirmed).toBe(false);
    expect(preview.profile?.confirmed).toBe(false);
  });

  it("tracks missing files without treating them as errors", () => {
    const preview = importLinkedInExport({
      positions: {
        fileName: "Positions.csv",
        content: `${POSITIONS_HEADER}\nAcme,Engineer,,Remote,2020-01-15,\n`,
      },
    });

    expect(preview.filesMissing).toEqual(["education", "skills", "profile"]);
    expect(preview.education).toEqual([]);
    expect(preview.skills).toEqual([]);
    expect(preview.profile).toBeNull();
    expect(preview.warnings.some((w) => w.code === "file-missing")).toBe(false);
  });

  it("surfaces an empty-input warning when no files at all are provided", () => {
    const preview = importLinkedInExport({});
    expect(preview.filesMissing).toEqual(["positions", "education", "skills", "profile"]);
    expect(preview.warnings.some((w) => w.code === "empty-input")).toBe(true);
  });

  it("propagates per-file warnings up to the combined preview", () => {
    const preview = importLinkedInExport({
      positions: { fileName: "Positions.csv", content: "" },
    });
    expect(preview.warnings.some((w) => w.code === "file-empty" && w.file === "Positions.csv")).toBe(
      true,
    );
  });
});
