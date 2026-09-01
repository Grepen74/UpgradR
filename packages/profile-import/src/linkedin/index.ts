import { warning, type ImportedItem, type ImportWarning } from "../types";
import { parseEducationCsv, type ImportedEducation } from "./education";
import { parsePositionsCsv, type ImportedExperience } from "./positions";
import { parseProfileCsv, type ImportedProfileSummary } from "./profile";
import { parseSkillsCsv, type ImportedSkill } from "./skills";

export type { ImportedEducation, ImportedExperience, ImportedProfileSummary, ImportedSkill };

/** A single decoded input file. Decoding/decompression is the caller's job. */
export interface NamedFileContent {
  fileName: string;
  content: string;
}

export type LinkedInFileKind = "positions" | "education" | "skills" | "profile";

/**
 * LinkedIn "Data export" files are all optional and independent: a user may
 * supply any subset. Pass `null`/`undefined` (or omit) for files they didn't
 * provide.
 */
export interface LinkedInExportFiles {
  positions?: NamedFileContent | null;
  education?: NamedFileContent | null;
  skills?: NamedFileContent | null;
  profile?: NamedFileContent | null;
}

export interface LinkedInImportPreview {
  profile: ImportedItem<ImportedProfileSummary> | null;
  experiences: ImportedItem<ImportedExperience>[];
  education: ImportedItem<ImportedEducation>[];
  skills: ImportedItem<ImportedSkill>[];
  warnings: ImportWarning[];
  filesProcessed: string[];
  filesMissing: LinkedInFileKind[];
}

/**
 * Builds a normalized, unconfirmed import preview from whichever LinkedIn
 * data-export CSV files the caller has decoded content for. No network
 * access, scraping, or ZIP handling happens here — this function only reads
 * the strings it is given.
 */
export function importLinkedInExport(files: LinkedInExportFiles): LinkedInImportPreview {
  const warnings: ImportWarning[] = [];
  const filesProcessed: string[] = [];
  const filesMissing: LinkedInFileKind[] = [];

  let profile: ImportedItem<ImportedProfileSummary> | null = null;
  let experiences: ImportedItem<ImportedExperience>[] = [];
  let education: ImportedItem<ImportedEducation>[] = [];
  let skills: ImportedItem<ImportedSkill>[] = [];

  if (files.positions) {
    filesProcessed.push(files.positions.fileName);
    const result = parsePositionsCsv(files.positions.content, files.positions.fileName);
    experiences = result.items;
    warnings.push(...result.warnings);
  } else {
    filesMissing.push("positions");
  }

  if (files.education) {
    filesProcessed.push(files.education.fileName);
    const result = parseEducationCsv(files.education.content, files.education.fileName);
    education = result.items;
    warnings.push(...result.warnings);
  } else {
    filesMissing.push("education");
  }

  if (files.skills) {
    filesProcessed.push(files.skills.fileName);
    const result = parseSkillsCsv(files.skills.content, files.skills.fileName);
    skills = result.items;
    warnings.push(...result.warnings);
  } else {
    filesMissing.push("skills");
  }

  if (files.profile) {
    filesProcessed.push(files.profile.fileName);
    const result = parseProfileCsv(files.profile.content, files.profile.fileName);
    profile = result.item;
    warnings.push(...result.warnings);
  } else {
    filesMissing.push("profile");
  }

  if (filesProcessed.length === 0) {
    warnings.push(warning("empty-input", "No LinkedIn export files were provided."));
  }

  return { profile, experiences, education, skills, warnings, filesProcessed, filesMissing };
}
