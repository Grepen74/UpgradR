import { describe, expect, it } from "vitest";

import { findContactDetails, stripContactDetails } from "./contactDetails";

describe("findContactDetails", () => {
  it("finds an email address", () => {
    const found = findContactDetails("Reach me at john.ahlinder@example.com any time.");

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "email", value: "john.ahlinder@example.com" });
  });

  it("finds international and national phone numbers", () => {
    expect(findContactDetails("+46 70 123 45 67")[0]).toMatchObject({ kind: "phone" });
    expect(findContactDetails("070-123 45 67")[0]).toMatchObject({ kind: "phone" });
    expect(findContactDetails("(415) 555-2671")[0]).toMatchObject({ kind: "phone" });
  });

  it("does not mistake a year range for a phone number", () => {
    // The single most likely false positive in a resume: every role has one.
    expect(findContactDetails("Volvo Cars, 1995 - 2001")).toEqual([]);
    expect(findContactDetails("2018-2024")).toEqual([]);
  });

  it("does not mistake ISO dates for a phone number", () => {
    expect(findContactDetails("2021-03-01")).toEqual([]);
    expect(findContactDetails("2021-03-01 - 2024-01-01")).toEqual([]);
  });

  it("does not flag small quantities", () => {
    expect(findContactDetails("Led a team of 3-5 engineers over 10 years")).toEqual([]);
  });

  it("finds profile URLs but leaves bare company names alone", () => {
    const found = findContactDetails(
      "www.linkedin.com/in/jahlinder — worked at Volvo Cars and Spotify",
    );

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "url" });
  });

  it("finds street addresses and postal codes", () => {
    expect(findContactDetails("12 Kungsgatan, 411 19 Göteborg").length).toBeGreaterThan(0);
    expect(findContactDetails("221 Baker Street")[0]).toMatchObject({ kind: "address" });
  });

  it("reports matches in document order without overlaps", () => {
    const found = findContactDetails(
      "john@example.com | +46 70 123 45 67 | www.example.com/cv",
    );

    expect(found.map((match) => match.kind)).toEqual(["email", "phone", "url"]);
    expect(found.map((match) => match.index)).toEqual(
      [...found.map((match) => match.index)].sort((a, b) => a - b),
    );
  });

  it("does not double-report the domain inside an email as a URL", () => {
    const found = findContactDetails("Contact: john@example.com");

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "email" });
  });

  it("returns nothing for empty input", () => {
    expect(findContactDetails("")).toEqual([]);
  });

  it("handles a whole realistic resume without false positives", () => {
    // Regression guard built from a real-shaped CV. Two defects showed up here
    // that the narrow cases above all missed: "100 000 000 users" was read as
    // a phone number, and a scheme-less "linkedin.com/in/..." was not found at
    // all -- which is how nearly everyone actually writes it.
    const resume = [
      "John Ahlinder",
      "Gothenburg, Sweden | john.ahlinder@example.com | +46 70 123 45 67",
      "linkedin.com/in/jahlinder",
      "",
      "SUMMARY",
      "Senior iOS developer with 12+ years building consumer apps. Led teams of 5-8 engineers.",
      "Shipped 15 releases in 2023 alone, reaching 2 000 000 monthly active users.",
      "",
      "EXPERIENCE",
      "Volvo Cars, Gothenburg - Senior iOS Engineer",
      "2019 - 2024",
      "- Reduced crash rate from 1.2% to 0.3% across 4 500 000 sessions.",
      "- Owned playlist sync for 100 000 000 users.",
      "",
      "EDUCATION",
      "Chalmers University of Technology, MSc Computer Science, 2009 - 2014",
    ].join("\n");

    const found = findContactDetails(resume);

    expect(found.map((match) => match.kind)).toEqual(["email", "phone", "url"]);
    expect(found.map((match) => match.value)).toEqual([
      "john.ahlinder@example.com",
      "+46 70 123 45 67",
      "linkedin.com/in/jahlinder",
    ]);
  });

  it("does not read large space-grouped quantities as phone numbers", () => {
    expect(findContactDetails("reaching 100 000 000 users")).toEqual([]);
    expect(findContactDetails("a budget of 25 000 000 SEK")).toEqual([]);
  });

  it("finds a profile URL written without a scheme", () => {
    expect(findContactDetails("github.com/jahlinder")[0]).toMatchObject({ kind: "url" });
    expect(findContactDetails("linkedin.com/in/jahlinder")[0]).toMatchObject({ kind: "url" });
  });

  it("still finds irregularly grouped national numbers", () => {
    expect(findContactDetails("070 123 45 67")[0]).toMatchObject({ kind: "phone" });
  });
});

describe("stripContactDetails", () => {
  it("removes a LinkedIn-style contact block but keeps the experience", () => {
    const resume = [
      "John Ahlinder",
      "john.ahlinder@example.com",
      "+46 70 123 45 67",
      "www.linkedin.com/in/jahlinder",
      "",
      "Summary",
      "Senior iOS engineer with 12 years of experience.",
      "",
      "Experience",
      "Volvo Cars — Senior iOS Engineer, 2019 - 2024",
    ].join("\n");

    const result = stripContactDetails(resume);

    expect(result.matches).toHaveLength(3);
    expect(result.text).toContain("John Ahlinder");
    expect(result.text).toContain("Senior iOS engineer with 12 years of experience.");
    expect(result.text).toContain("Volvo Cars — Senior iOS Engineer, 2019 - 2024");
    expect(result.text).not.toContain("john.ahlinder@example.com");
    expect(result.text).not.toContain("linkedin.com");
    expect(result.text).not.toMatch(/\+46/);
  });

  it("leaves text without contact details completely untouched", () => {
    const resume = "Senior iOS engineer. Shipped 4 apps between 2019 and 2024.";

    const result = stripContactDetails(resume);

    expect(result.text).toBe(resume);
    expect(result.matches).toEqual([]);
  });

  it("does not leave a ragged hole where a contact line used to be", () => {
    const result = stripContactDetails("Name\njohn@example.com\nSummary here");

    expect(result.text).not.toMatch(/\n\s*\n\s*\n/);
    expect(result.text).toContain("Name");
    expect(result.text).toContain("Summary here");
  });

  it("reports what it removed so the user can review the decision", () => {
    const result = stripContactDetails("a@b.com and +46 70 123 45 67");

    expect(result.matches.map((match) => match.kind)).toEqual(["email", "phone"]);
    expect(result.matches[0]).toMatchObject({ value: "a@b.com" });
  });
});

describe("street addresses in name-then-number order", () => {
  it("finds a Swedish street address", () => {
    const found = findContactDetails("Storgatan 4, Gothenburg");
    expect(found.map((m) => m.value)).toEqual(["Storgatan 4"]);
    expect(found[0]).toMatchObject({ kind: "address" });
  });

  it("finds a multi-word Swedish street address", () => {
    expect(findContactDetails("Stora Nygatan 12 B").map((m) => m.value)).toEqual([
      "Stora Nygatan 12 B",
    ]);
  });

  it("finds German and Dutch street addresses", () => {
    expect(findContactDetails("Hauptstraße 3").map((m) => m.value)).toEqual(["Hauptstraße 3"]);
    expect(findContactDetails("Keizersgracht 21").map((m) => m.value)).toEqual([]);
    expect(findContactDetails("Herenstraat 21").map((m) => m.value)).toEqual(["Herenstraat 21"]);
  });

  it("does not treat a versioned technology as an address", () => {
    expect(findContactDetails("Swift 5, iOS 17, Android 14")).toEqual([]);
  });

  it("does not treat a role with a number as an address", () => {
    expect(findContactDetails("Led a team of Engineer 3 and Engineer 4")).toEqual([]);
  });

  it("strips a Swedish address but keeps the city", () => {
    const result = stripContactDetails("Storgatan 4, Gothenburg, Sweden\nSenior iOS engineer.");
    expect(result.text).not.toContain("Storgatan");
    expect(result.text).toContain("Gothenburg, Sweden");
    expect(result.text).toContain("Senior iOS engineer.");
  });
});
