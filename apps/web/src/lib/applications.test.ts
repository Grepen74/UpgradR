import type { ApplicationStatus } from "@upgradr/contracts";
import { describe, expect, it } from "vitest";

import type { ApplicationSummary, TaskSummary } from "../api";
import {
  availableNextStatuses,
  deriveAttentionBadges,
  groupStatusesByStage,
  nextFollowUpTask,
} from "./applications";

describe("availableNextStatuses", () => {
  it("offers every other status from a non-terminal status", () => {
    const next = availableNextStatuses("applied");
    expect(next).not.toContain("applied");
    expect(next).toContain("interviewing");
    expect(next).toContain("archived");
  });

  it("only offers archived from a terminal status", () => {
    expect(availableNextStatuses("rejected")).toEqual(["archived"]);
    expect(availableNextStatuses("accepted")).toEqual(["archived"]);
  });

  it("offers nothing further once archived", () => {
    expect(availableNextStatuses("archived")).toEqual([]);
  });
});

describe("groupStatusesByStage", () => {
  it("groups statuses by Kanban column in board order", () => {
    const groups = groupStatusesByStage(availableNextStatuses("applied"));
    expect(groups.map((group) => group.stage)).toEqual([
      "inbox",
      "shortlist",
      "applied",
      "interviewing",
      "offer",
      "closed",
    ]);
  });

  it("puts every closed outcome status under a single Closed group", () => {
    const groups = groupStatusesByStage(availableNextStatuses("interviewing"));
    const closed = groups.find((group) => group.stage === "closed");
    expect(closed?.statuses).toEqual(
      expect.arrayContaining(["accepted", "rejected", "withdrawn", "dismissed", "archived"]),
    );
  });

  it("omits empty groups", () => {
    expect(groupStatusesByStage(availableNextStatuses("archived"))).toEqual([]);
  });
});

function makeApplication(
  overrides: Partial<Pick<ApplicationSummary, "current_status" | "updated_at">> = {},
): Pick<ApplicationSummary, "current_status" | "updated_at"> {
  return {
    current_status: "applied" as ApplicationStatus,
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<Pick<TaskSummary, "due_at" | "is_completed">> = {}) {
  return { due_at: null, is_completed: false, ...overrides };
}

describe("deriveAttentionBadges", () => {
  const now = new Date("2024-06-15T12:00:00.000Z");

  it("flags overdue when an incomplete task's due date has passed", () => {
    const badges = deriveAttentionBadges(
      makeApplication(),
      [makeTask({ due_at: "2024-06-01T00:00:00.000Z" })],
      now,
    );
    expect(badges).toContain("overdue");
    expect(badges).not.toContain("action_needed");
  });

  it("flags action needed when a task is due within 48 hours", () => {
    const badges = deriveAttentionBadges(
      makeApplication(),
      [makeTask({ due_at: "2024-06-16T18:00:00.000Z" })],
      now,
    );
    expect(badges).toEqual(["action_needed"]);
  });

  it("flags action needed when an offer has no tracked follow-up task", () => {
    const badges = deriveAttentionBadges(makeApplication({ current_status: "offer" }), [], now);
    expect(badges).toContain("action_needed");
  });

  it("flags awaiting feedback for applied/interviewing with no urgent task", () => {
    expect(deriveAttentionBadges(makeApplication({ current_status: "applied" }), [], now)).toContain(
      "awaiting_feedback",
    );
    expect(
      deriveAttentionBadges(makeApplication({ current_status: "interviewing" }), [], now),
    ).toContain("awaiting_feedback");
  });

  it("flags stale when untouched for 21+ days and not closed", () => {
    const badges = deriveAttentionBadges(
      makeApplication({ current_status: "saved", updated_at: "2024-05-01T00:00:00.000Z" }),
      [],
      now,
    );
    expect(badges).toContain("stale");
  });

  it("never flags a closed application", () => {
    expect(
      deriveAttentionBadges(
        makeApplication({ current_status: "archived", updated_at: "2024-01-01T00:00:00.000Z" }),
        [makeTask({ due_at: "2024-01-01T00:00:00.000Z" })],
        now,
      ),
    ).toEqual([]);
  });

  it("caps the result at 2 badges, prioritizing overdue then stale", () => {
    const badges = deriveAttentionBadges(
      makeApplication({ current_status: "applied", updated_at: "2024-01-01T00:00:00.000Z" }),
      [makeTask({ due_at: "2024-06-01T00:00:00.000Z" })],
      now,
    );
    expect(badges).toEqual(["overdue", "stale"]);
  });
});

describe("nextFollowUpTask", () => {
  it("returns the soonest incomplete task for the application", () => {
    const tasks = [
      makeTask({ due_at: "2024-07-01T00:00:00.000Z" }) as TaskSummary,
      makeTask({ due_at: "2024-06-20T00:00:00.000Z" }) as TaskSummary,
    ].map((task, index) => ({ ...task, application_id: "app-1", id: `t${index}` }));
    const result = nextFollowUpTask("app-1", tasks);
    expect(result?.due_at).toBe("2024-06-20T00:00:00.000Z");
  });

  it("ignores completed tasks and tasks for other applications", () => {
    const tasks = [
      { ...makeTask({ is_completed: true, due_at: "2024-06-01T00:00:00.000Z" }), application_id: "app-1", id: "t1" },
      { ...makeTask({ due_at: "2024-06-05T00:00:00.000Z" }), application_id: "app-2", id: "t2" },
    ] as TaskSummary[];
    expect(nextFollowUpTask("app-1", tasks)).toBeUndefined();
  });

  it("sorts undated tasks after dated ones", () => {
    const tasks = [
      { ...makeTask({ due_at: null }), application_id: "app-1", id: "t1" },
      { ...makeTask({ due_at: "2024-06-20T00:00:00.000Z" }), application_id: "app-1", id: "t2" },
    ] as TaskSummary[];
    expect(nextFollowUpTask("app-1", tasks)?.id).toBe("t2");
  });
});
