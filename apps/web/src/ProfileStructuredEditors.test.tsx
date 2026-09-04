import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./api";
import {
  EducationEditor,
  ExperienceEditor,
  SkillsEditor,
} from "./ProfileStructuredEditors";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const experience = {
  id: "exp-1",
  company: "Volvo Cars",
  title: "Senior iOS Engineer",
  description: "Built the companion app.",
  start_date: "2021-03-01",
  end_date: null,
  is_current: true,
  is_confirmed: true,
  sort_order: 0,
};

describe("ExperienceEditor", () => {
  it("renders an existing role with its date range", () => {
    render(<ExperienceEditor entries={[experience]} onChanged={() => {}} />);

    expect(screen.getByText("Senior iOS Engineer · Volvo Cars")).toBeVisible();
    expect(screen.getByText("2021-03 – Present")).toBeVisible();
  });

  it("adds a role and clears the form", async () => {
    const add = vi
      .spyOn(api, "addProfileExperience")
      .mockResolvedValue({ entry: experience });
    const onChanged = vi.fn();

    render(<ExperienceEditor entries={[]} onChanged={onChanged} />);

    fireEvent.change(screen.getByLabelText("Role title"), {
      target: { value: "Staff Engineer" },
    });
    fireEvent.change(screen.getByLabelText("Company"), {
      target: { value: "Spotify" },
    });
    fireEvent.change(screen.getByLabelText("Start date"), {
      target: { value: "2024-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add role" }));

    await waitFor(() => {
      expect(add).toHaveBeenCalledWith({
        company: "Spotify",
        title: "Staff Engineer",
        description: null,
        startDate: "2024-01-01",
        endDate: null,
        isCurrent: false,
      });
    });
    await waitFor(() => {
      expect(screen.getByLabelText("Role title")).toHaveValue("");
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("clears and disables the end date when the role is marked current", () => {
    render(<ExperienceEditor entries={[]} onChanged={() => {}} />);

    const endDate = screen.getByLabelText("End date");
    fireEvent.change(endDate, { target: { value: "2025-01-01" } });
    expect(endDate).toHaveValue("2025-01-01");

    fireEvent.click(screen.getByLabelText("This is my current role"));

    // The database enforces profile_experiences_current_has_no_end, so the form
    // must not be able to submit a combination the constraint would reject.
    expect(endDate).toHaveValue("");
    expect(endDate).toBeDisabled();
  });

  it("surfaces the server message when adding fails", async () => {
    vi.spyOn(api, "addProfileExperience").mockRejectedValue(
      new Error("End date must not precede the start date."),
    );

    render(<ExperienceEditor entries={[]} onChanged={() => {}} />);

    fireEvent.change(screen.getByLabelText("Role title"), { target: { value: "Dev" } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: "Add role" }));

    expect(
      await screen.findByText("End date must not precede the start date."),
    ).toBeVisible();
  });

  it("removes a role", async () => {
    const remove = vi
      .spyOn(api, "deleteProfileEntry")
      .mockResolvedValue({ deleted: true });
    const onChanged = vi.fn();

    render(<ExperienceEditor entries={[experience]} onChanged={onChanged} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove Senior iOS Engineer at Volvo Cars" }),
    );

    await waitFor(() => {
      expect(remove).toHaveBeenCalledWith("experiences", "exp-1");
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("marks unconfirmed rows, because agents cannot read them", () => {
    render(
      <ExperienceEditor
        entries={[{ ...experience, is_confirmed: false }]}
        onChanged={() => {}}
      />,
    );

    expect(screen.getByText("Needs review")).toBeVisible();
  });
});

describe("EducationEditor", () => {
  it("adds an entry with optional fields omitted", async () => {
    const add = vi.spyOn(api, "addProfileEducation").mockResolvedValue({
      entry: {
        id: "edu-1",
        institution: "Chalmers",
        degree: null,
        field_of_study: null,
        is_confirmed: true,
        sort_order: 0,
      },
    });

    render(<EducationEditor entries={[]} onChanged={() => {}} />);

    fireEvent.change(screen.getByLabelText("Institution"), {
      target: { value: "Chalmers" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add education" }));

    await waitFor(() => {
      expect(add).toHaveBeenCalledWith({
        institution: "Chalmers",
        degree: null,
        fieldOfStudy: null,
      });
    });
  });
});

describe("SkillsEditor", () => {
  it("adds a skill", async () => {
    const add = vi.spyOn(api, "addProfileSkill").mockResolvedValue({
      entry: { id: "skill-1", name: "Swift", evidence: null, is_confirmed: true },
    });

    render(<SkillsEditor entries={[]} onChanged={() => {}} />);

    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "Swift" } });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));

    await waitFor(() => {
      expect(add).toHaveBeenCalledWith({ name: "Swift", evidence: null });
    });
  });

  it("reports a duplicate skill from the unique constraint", async () => {
    vi.spyOn(api, "addProfileSkill").mockRejectedValue(
      new Error("That entry already exists."),
    );

    render(<SkillsEditor entries={[]} onChanged={() => {}} />);

    fireEvent.change(screen.getByLabelText("Skill"), { target: { value: "Swift" } });
    fireEvent.click(screen.getByRole("button", { name: "Add skill" }));

    expect(await screen.findByText("That entry already exists.")).toBeVisible();
  });
});
