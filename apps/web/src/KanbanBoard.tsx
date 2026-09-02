import { kanbanStageLabels, kanbanStageCanonicalStatus, kanbanStages, stageForStatus, type KanbanStage } from "@upgradr/domain";
import { normalizeHttpUrlInput, safeSourceUrlSchema, type ApplicationStatus } from "@upgradr/contracts";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";

import { api, type ApplicationSummary, type TaskSummary } from "./api";
import { StatusMessage } from "./components/Feedback";
import {
  ATTENTION_BADGE_LABELS,
  availableNextStatuses,
  deriveAttentionBadges,
  nextFollowUpTask,
} from "./lib/applications";
import { formatRelativeAge } from "./lib/time";

// The active board never renders (or accepts drops onto) a "Closed" column
// -- closing an opportunity happens exclusively through the explicit outcome
// control in the opportunity detail view (see OpportunityDetail's
// CloseSection), never implicitly via drag-and-drop. Closed opportunities
// live in the separate "Closed opportunities" view (More > Closed).
const activeKanbanStages = kanbanStages.filter((stage): stage is Exclude<KanbanStage, "closed"> => stage !== "closed");

function canonicalStatusForDrop(stage: Exclude<KanbanStage, "closed">): ApplicationStatus {
  return kanbanStageCanonicalStatus[stage];
}

export function KanbanBoard({
  applications,
  closedCount = 0,
  onRefresh,
  onOpenApplication,
  onOpenClosed,
}: {
  applications: ApplicationSummary[];
  closedCount?: number;
  onRefresh: () => Promise<void>;
  onOpenApplication: (applicationId: string) => void;
  onOpenClosed?: () => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [formMessage, setFormMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>();
  const [updatingId, setUpdatingId] = useState<string>();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [dragOverStage, setDragOverStage] = useState<Exclude<KanbanStage, "closed">>();

  const refreshTasks = useCallback(async () => {
    try {
      const { tasks: loaded } = await api.getTasks();
      setTasks(loaded);
    } catch {
      // Tasks are supplementary (badges/next follow-up) -- a load failure
      // here shouldn't block the board itself from rendering.
    }
  }, []);

  useEffect(() => {
    void refreshTasks();
  }, [applications, refreshTasks]);

  const columns = useMemo(() => {
    const byStage = new Map<Exclude<KanbanStage, "closed">, ApplicationSummary[]>(
      activeKanbanStages.map((stage) => [stage, []]),
    );
    for (const application of applications) {
      const stage = stageForStatus(application.current_status);
      if (stage === "closed") {
        // Defense in depth: the active board never shows closed items, even
        // if a caller passes an unfiltered application list.
        continue;
      }
      byStage.get(stage)?.push(application);
    }
    return byStage;
  }, [applications]);

  async function addOpportunity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setFormMessage(undefined);

    try {
      const sourceUrl = normalizeHttpUrlInput(String(form.get("sourceUrl") ?? ""));
      if (!safeSourceUrlSchema.safeParse(sourceUrl).success) {
        throw new Error("Enter a valid job posting URL, such as https://www.example.com.");
      }
      await api.createApplication({
        title: String(form.get("title") ?? ""),
        companyName: String(form.get("companyName") ?? ""),
        ...(String(form.get("location") ?? "")
          ? { location: String(form.get("location") ?? "") }
          : {}),
        sourceUrl,
        sourceProvider: new URL(sourceUrl).hostname,
      });
      formElement.reset();
      setShowForm(false);
      await onRefresh();
    } catch (error) {
      setFormMessage(error instanceof Error ? error.message : "Unable to add opportunity.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(applicationId: string, status: ApplicationStatus) {
    setUpdatingId(applicationId);
    setStatusMessage(undefined);
    try {
      await api.updateApplicationStatus(applicationId, status);
      await onRefresh();
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Unable to update application status.",
      );
    } finally {
      setUpdatingId(undefined);
    }
  }

  function handleDrop(
    stage: Exclude<KanbanStage, "closed">,
    applicationId: string,
    currentStatus: ApplicationStatus,
  ) {
    setDragOverStage(undefined);
    if (stageForStatus(currentStatus) === stage) {
      return;
    }
    const nextStatus = canonicalStatusForDrop(stage);
    if (nextStatus === currentStatus) {
      return;
    }
    if (!availableNextStatuses(currentStatus).includes(nextStatus)) {
      setStatusMessage(`Can't move directly from ${currentStatus} to ${kanbanStageLabels[stage]}.`);
      return;
    }
    void changeStatus(applicationId, nextStatus);
  }

  return (
    <>
      <div className="panel-heading panel-heading-spaced">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h2>Every opportunity, one place to move it forward</h2>
        </div>
        <button className="button primary" onClick={() => setShowForm((value) => !value)}>
          {showForm ? "Close form" : "Add opportunity"}
        </button>
      </div>

      {showForm ? (
        <form className="opportunity-form panel" onSubmit={(event) => void addOpportunity(event)}>
          <div>
            <label htmlFor="title">Role</label>
            <input id="title" name="title" required maxLength={200} />
          </div>
          <div>
            <label htmlFor="companyName">Company</label>
            <input id="companyName" name="companyName" required maxLength={200} />
          </div>
          <div>
            <label htmlFor="location">Location</label>
            <input id="location" name="location" maxLength={200} />
          </div>
          <div className="wide">
            <label htmlFor="sourceUrl">Job posting URL</label>
            <input
              id="sourceUrl"
              name="sourceUrl"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="www.example.com/jobs/role"
              required
              onBlur={(event) => {
                event.currentTarget.value = normalizeHttpUrlInput(event.currentTarget.value);
              }}
            />
          </div>
          <div className="form-actions wide">
            {formMessage ? <StatusMessage>{formMessage}</StatusMessage> : <span />}
            <button className="button primary" disabled={saving}>
              {saving ? "Saving..." : "Save opportunity"}
            </button>
          </div>
        </form>
      ) : null}

      {statusMessage ? <StatusMessage>{statusMessage}</StatusMessage> : null}

      {applications.length === 0 ? (
        <article className="panel">
          <div className="empty-state">
            <span className="empty-icon">↗</span>
            <h3>{closedCount > 0 ? "No active opportunities" : "No opportunities yet"}</h3>
            <p>
              {closedCount > 0
                ? `${closedCount} closed ${closedCount === 1 ? "opportunity is" : "opportunities are"} available under More.`
                : "Connect an MCP client or add an opportunity manually to get started."}
            </p>
            {closedCount > 0 && onOpenClosed ? (
              <button className="button secondary" type="button" onClick={onOpenClosed}>
                View closed opportunities
              </button>
            ) : null}
          </div>
        </article>
      ) : (
        <div className="kanban-board" role="group" aria-label="Opportunity pipeline, organized by stage">
          {activeKanbanStages.map((stage) => {
            const stageApplications = columns.get(stage) ?? [];
            return (
              <section
                className={`kanban-column${dragOverStage === stage ? " drag-over" : ""}`}
                key={stage}
                aria-label={`${kanbanStageLabels[stage]} (${stageApplications.length})`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragOverStage(stage);
                }}
                onDragLeave={() => setDragOverStage((current) => (current === stage ? undefined : current))}
                onDrop={(event) => {
                  event.preventDefault();
                  const applicationId = event.dataTransfer.getData("text/plain");
                  const application = applications.find((item) => item.id === applicationId);
                  if (application) {
                    handleDrop(stage, applicationId, application.current_status);
                  }
                }}
              >
                <header className="kanban-column-heading">
                  <h3>{kanbanStageLabels[stage]}</h3>
                  <span className="pill pill-muted">{stageApplications.length}</span>
                </header>

                <div className="kanban-column-cards">
                  {stageApplications.length === 0 ? (
                    <p className="kanban-column-empty">No opportunities here.</p>
                  ) : (
                    stageApplications.map((application) => (
                      <OpportunityCard
                        key={application.id}
                        application={application}
                        tasks={tasks}
                        updating={updatingId === application.id}
                        onOpen={() => onOpenApplication(application.id)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </>
  );
}

function OpportunityCard({
  application,
  tasks,
  updating,
  onOpen,
}: {
  application: ApplicationSummary;
  tasks: TaskSummary[];
  updating: boolean;
  onOpen: () => void;
}) {
  const applicationTasks = tasks.filter((task) => task.application_id === application.id);
  const badges = deriveAttentionBadges(application, applicationTasks);
  const followUp = nextFollowUpTask(application.id, applicationTasks);

  return (
    <article
      className={`kanban-card${updating ? " kanban-card-updating" : ""}`}
      draggable
      aria-busy={updating}
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", application.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button type="button" className="kanban-card-open" onClick={onOpen}>
        <strong>{application.title}</strong>
        <span>
          {application.company_name}
          {application.location ? ` · ${application.location}` : ""}
        </span>
      </button>

      <div className="kanban-card-meta">
        {application.match_score === null ? null : (
          <span className="pill pill-muted">{application.match_score}% match</span>
        )}
        <span>{application.source_provider}</span>
        <span>Updated {formatRelativeAge(application.updated_at)}</span>
      </div>

      {followUp ? (
        <p className="kanban-card-followup">
          Next: {followUp.title} ·{" "}
          {followUp.due_at ? new Date(followUp.due_at).toLocaleDateString() : "no due date"}
        </p>
      ) : null}

      {application.labels.length > 0 ? (
        <div className="label-list" aria-label={`Labels for ${application.title}`}>
          {application.labels.map((label) => (
            <span className="label-chip" key={label.id}>
              {label.name}
            </span>
          ))}
        </div>
      ) : null}

      {badges.length > 0 ? (
        <div className="badge-list" aria-label={`Attention flags for ${application.title}`}>
          {badges.map((badge) => (
            <span className={`badge badge-${badge}`} key={badge}>
              {ATTENTION_BADGE_LABELS[badge]}
            </span>
          ))}
        </div>
      ) : null}
    </article>
  );
}
