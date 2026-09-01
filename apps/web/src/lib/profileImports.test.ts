import { describe, expect, it } from "vitest";

import { matchLinkedInFileKind } from "./profileImports";

describe("matchLinkedInFileKind", () => {
  it("matches Positions.csv", () => {
    expect(matchLinkedInFileKind("Positions.csv")).toBe("positions");
  });

  it("matches Education.csv", () => {
    expect(matchLinkedInFileKind("Education.csv")).toBe("education");
  });

  it("matches Skills.csv", () => {
    expect(matchLinkedInFileKind("Skills.csv")).toBe("skills");
  });

  it("matches Profile.csv", () => {
    expect(matchLinkedInFileKind("Profile.csv")).toBe("profile");
  });

  it("is case-insensitive", () => {
    expect(matchLinkedInFileKind("POSITIONS.CSV")).toBe("positions");
  });

  it("matches regardless of surrounding path/prefix", () => {
    expect(matchLinkedInFileKind("LinkedInDataExport_Education.csv")).toBe("education");
  });

  it("returns null for an unrecognized filename", () => {
    expect(matchLinkedInFileKind("Connections.csv")).toBeNull();
  });

  it("returns null for an empty filename", () => {
    expect(matchLinkedInFileKind("")).toBeNull();
  });
});
