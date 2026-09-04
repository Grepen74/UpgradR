import { kanbanStageLabels, kanbanStageCanonicalStatus, kanbanStages, stageForStatus, type KanbanStage } from "@upgradr/domain";
import { normalizeHttpUrlInput, safeSourceUrlSchema, type ApplicationStatus } from "@upgradr/contracts";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { api, type ApplicationSummary, type TaskSummary } from "./api";
import { StatusMessage } from "./components/Feedback";
import { ConfirmDialog } from "./components/ConfirmDialog";
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

/**
 * Produces the destination column's complete new order.
 *
 * `index` is a *gap* in the column as the user currently sees it, so for a
 * same-column move it is measured against a list that still contains the
 * dragged card. Removing the card first shifts every gap after its old
 * position down by one, which has to be compensated for or a card dragged
 * downwards always lands one slot too far.
 */
export function orderAfterDrop(
  columnIds: readonly string[],
  movedId: string,
  index: number,
): string[] {
  const from = columnIds.indexOf(movedId);
  const without = columnIds.filter((id) => id !== movedId);
  const shifted = from >= 0 && from < index ? index - 1 : index;
  const clamped = Math.max(0, Math.min(shifted, without.length));
  return [...without.slice(0, clamped), movedId, ...without.slice(clamped)];
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
  // Where a dragged card would land: the column, and the gap index within it.
  const [dropTarget, setDropTarget] = useState<{
    stage: Exclude<KanbanStage, "closed">;
    index: number;
  }>();
  const [announcement, setAnnouncement] = useState("");
  // The card whose dismissal is awaiting confirmation. Held here rather than
  // in the card so only one dialog can ever be open, and so the modal is not
  // nested inside a draggable article.
  const [pendingDismissal, setPendingDismissal] = useState<ApplicationSummary>();

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

  /**
   * Applies a drop (or a keyboard move) of one card into `stage` at `index`.
   *
   * Cross-column moves are still refused when the status taxonomy forbids the
   * transition, exactly as before -- position is a second dimension on top of
   * the pipeline rules, not a way around them.
   */
  async function moveCard(
    application: ApplicationSummary,
    stage: Exclude<KanbanStage, "closed">,
    index: number,
  ) {
    const sourceStage = stageForStatus(application.current_status);
    const sameColumn = sourceStage === stage;
    const nextStatus = sameColumn ? application.current_status : canonicalStatusForDrop(stage);

    if (!sameColumn && !availableNextStatuses(application.current_status).includes(nextStatus)) {
      setStatusMessage(
        `Can't move directly from ${application.current_status} to ${kanbanStageLabels[stage]}.`,
      );
      return;
    }

    const columnIds = (columns.get(stage) ?? []).map((item) => item.id);
    const orderedIds = orderAfterDrop(columnIds, application.id, index);

    if (sameColumn && orderedIds.join() === columnIds.join()) {
      return;
    }

    setUpdatingId(application.id);
    setStatusMessage(undefined);
    try {
      await api.moveApplicationOnBoard(application.id, nextStatus, orderedIds);
      setAnnouncement(
        `${application.title} moved to position ${orderedIds.indexOf(application.id) + 1} of ${
          orderedIds.length
        } in ${kanbanStageLabels[stage]}.`,
      );
      await onRefresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to move opportunity.");
    } finally {
      setUpdatingId(undefined);
    }
  }

  /**
   * Takes an opportunity off the board by dismissing it.
   *
   * Deliberately a status transition and not a delete. `dismissed` is a
   * terminal status, so the card leaves the active board, but the row survives
   * -- and that is the point: an `after update` trigger records a permanent
   * suppression for the posting's canonical URL and provider job id, so no
   * later agent run re-proposes it. Deleting the row instead would erase the
   * de-duplication memory along with the card, which is exactly the case
   * `opportunity_suppressions` exists to cover.
   */
  async function dismissOpportunity(application: ApplicationSummary) {
    setUpdatingId(application.id);
    setStatusMessage(undefined);
    try {
      await api.updateApplicationStatus(application.id, "dismissed");
      setPendingDismissal(undefined);
      setAnnouncement(`${application.title} dismissed and moved to closed opportunities.`);
      await onRefresh();
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unable to dismiss opportunity.");
    } finally {
      setUpdatingId(undefined);
    }
  }

  /**
   * Keyboard equivalent of a drag, driven from each card's reorder handle.
   * Up/Down move within the column, Left/Right across columns, so the board is
   * operable without a pointer.
   */
  function moveByKeyboard(
    application: ApplicationSummary,
    direction: "up" | "down" | "left" | "right",
  ) {
    const stage = stageForStatus(application.current_status);
    if (stage === "closed") {
      return;
    }
    const columnIds = (columns.get(stage) ?? []).map((item) => item.id);
    const currentIndex = columnIds.indexOf(application.id);

    if (direction === "up" || direction === "down") {
      const target = currentIndex + (direction === "up" ? -1 : 1);
      if (target < 0 || target >= columnIds.length) {
        return;
      }
      // moveCard takes a *drop* index: a gap in the list as the user currently
      // sees it, which still contains this card. `target` is the final index
      // the card should end up at. Moving down, those differ by one, because
      // removing the card first closes the gap it used to occupy -- so passing
      // `target` straight through produced the unchanged order and the move
      // was silently dropped by the no-op guard below.
      void moveCard(application, stage, direction === "down" ? target + 1 : target);
      return;
    }

    const stageIndex = activeKanbanStages.indexOf(stage);
    const targetStage = activeKanbanStages[stageIndex + (direction === "left" ? -1 : 1)];
    if (!targetStage) {
      return;
    }
    // Entering a new column, the card goes where it sat in the old one, which
    // keeps a card the user had at the top near the top.
    void moveCard(application, targetStage, currentIndex);
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
            const dropIndex = dropTarget?.stage === stage ? dropTarget.index : undefined;
            return (
              <section
                className={`kanban-column${dropIndex === undefined ? "" : " drag-over"}`}
                key={stage}
                aria-label={`${kanbanStageLabels[stage]} (${stageApplications.length})`}
                onDragOver={(event) => {
                  event.preventDefault();
                  // Dragging over the column's padding (not a card) means
                  // "the end of this column".
                  setDropTarget((current) =>
                    current?.stage === stage ? current : { stage, index: stageApplications.length },
                  );
                }}
                onDragLeave={(event) => {
                  if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    return;
                  }
                  setDropTarget((current) => (current?.stage === stage ? undefined : current));
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const applicationId = event.dataTransfer.getData("text/plain");
                  const index = dropIndex ?? stageApplications.length;
                  setDropTarget(undefined);
                  const application = applications.find((item) => item.id === applicationId);
                  if (application) {
                    void moveCard(application, stage, index);
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
                    stageApplications.map((application, index) => (
                      <div key={application.id}>
                        {dropIndex === index ? <DropIndicator /> : null}
                        <OpportunityCard
                          application={application}
                          tasks={tasks}
                          updating={updatingId === application.id}
                          position={index + 1}
                          columnSize={stageApplications.length}
                          stageLabel={kanbanStageLabels[stage]}
                          onOpen={() => onOpenApplication(application.id)}
                          onDismiss={() => setPendingDismissal(application)}
                          onDragOverCard={(half) =>
                            setDropTarget({ stage, index: half === "top" ? index : index + 1 })
                          }
                          onDragFinished={() => setDropTarget(undefined)}
                          onKeyboardMove={(direction) => moveByKeyboard(application, direction)}
                        />
                      </div>
                    ))
                  )}
                  {dropIndex === stageApplications.length && stageApplications.length > 0 ? (
                    <DropIndicator />
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {pendingDismissal ? (
        <ConfirmDialog
          title={`Dismiss ${pendingDismissal.title}?`}
          confirmLabel="Dismiss"
          busy={updatingId === pendingDismissal.id}
          onCancel={() => setPendingDismissal(undefined)}
          onConfirm={() => void dismissOpportunity(pendingDismissal)}
        >
          <p>
            This removes {pendingDismissal.title} at {pendingDismissal.company_name} from the
            board. It is kept under More &rsaquo; Closed, where you can reopen it.
          </p>
          <p>
            Because it stays on record, connected agents will not propose this posting again.
          </p>
        </ConfirmDialog>
      ) : null}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

// A card-width line drawn in the gap the dragged card would drop into. The
// board otherwise gives no feedback about *where* in a column a drop lands,
// only which column.
function DropIndicator() {
  return <div className="kanban-drop-indicator" aria-hidden="true" />;
}

function OpportunityCard({
  application,
  tasks,
  updating,
  position,
  columnSize,
  stageLabel,
  onOpen,
  onDismiss,
  onDragOverCard,
  onDragFinished,
  onKeyboardMove,
}: {
  application: ApplicationSummary;
  tasks: TaskSummary[];
  updating: boolean;
  position: number;
  columnSize: number;
  stageLabel: string;
  onOpen: () => void;
  onDismiss: () => void;
  onDragOverCard: (half: "top" | "bottom") => void;
  onDragFinished: () => void;
  onKeyboardMove: (direction: "up" | "down" | "left" | "right") => void;
}) {
  const applicationTasks = tasks.filter((task) => task.application_id === application.id);
  const badges = deriveAttentionBadges(application, applicationTasks);
  const followUp = nextFollowUpTask(application.id, applicationTasks);
  // A card is both a drag handle and a link into the detail view, so the
  // press has to be classified on release: a press that ends roughly where it
  // started, without a drag, opens the opportunity. Anything else is a drag
  // and must not open anything.
  const press = useRef({ dragging: false, x: 0, y: 0 });

  return (
    <article
      className={`kanban-card${updating ? " kanban-card-updating" : ""}`}
      draggable
      aria-busy={updating}
      onPointerDown={(event) => {
        press.current = { dragging: false, x: event.clientX, y: event.clientY };
      }}
      onDragStart={(event) => {
        press.current.dragging = true;
        event.dataTransfer.setData("text/plain", application.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => {
        press.current.dragging = false;
        // A drag abandoned with Escape fires no drop and no dragleave, so the
        // indicator would otherwise stay painted where the card never landed.
        onDragFinished();
      }}
      onDragOver={(event) => {
        // Which half of the card the pointer is over decides whether the drop
        // lands above or below it -- the same convention every board UI uses.
        const bounds = event.currentTarget.getBoundingClientRect();
        onDragOverCard(event.clientY < bounds.top + bounds.height / 2 ? "top" : "bottom");
      }}
      onClick={(event) => {
        if (press.current.dragging) {
          return;
        }
        // The card's own controls (the title button, label removal, ...)
        // handle their own clicks.
        if ((event.target as HTMLElement).closest("button")) {
          return;
        }
        const movedX = Math.abs(event.clientX - press.current.x);
        const movedY = Math.abs(event.clientY - press.current.y);
        if (movedX > 5 || movedY > 5) {
          return;
        }
        onOpen();
      }}
    >
      <div className="kanban-card-top">
        <button type="button" className="kanban-card-open" onClick={onOpen}>
          <strong>{application.title}</strong>
          <span>
            {application.company_name}
            {application.location ? ` · ${application.location}` : ""}
          </span>
        </button>

        {/* Dragging is unavailable to keyboard and most screen-reader users,
            so the same reordering is bound to the arrow keys here. */}
        <button
          type="button"
          className="kanban-card-grip"
          aria-label={`Reorder ${application.title}, position ${position} of ${columnSize} in ${stageLabel}. Use the arrow keys to move it.`}
          title="Drag, or use the arrow keys, to move this card"
          onKeyDown={(event) => {
            const directions = {
              ArrowUp: "up",
              ArrowDown: "down",
              ArrowLeft: "left",
              ArrowRight: "right",
            } as const;
            const direction = directions[event.key as keyof typeof directions];
            if (!direction) {
              return;
            }
            event.preventDefault();
            event.stopPropagation();
            onKeyboardMove(direction);
          }}
        >
          <span aria-hidden="true">⠿</span>
        </button>
      </div>

      <div className="kanban-card-meta">
        {application.match_score === null ? null : (
          <span className="pill pill-muted">{application.match_score}% match</span>
        )}
        <span>{application.source_provider}</span>
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

      {/* The timestamp shares this trailing row with the dismiss control rather
          than the control having a row to itself. The match score and source
          stay up near the title: they are what the card is judged on, and
          pushing them below the labels and badges would bury them. */}
      <div className="kanban-card-footer">
        <span>Updated {formatRelativeAge(application.updated_at)}</span>

        {/* `margin-left: auto` is the spacer that pins this to the trailing
            edge. Always visible rather than revealed on hover, for the same
            reason the reorder handle is — a hover-only control does not exist
            for touch or keyboard users. */}
        <button
          type="button"
          className="kanban-card-dismiss"
          aria-label={`Dismiss ${application.title}`}
          title="Dismiss this opportunity"
          onClick={onDismiss}
        >
          {/* An inline SVG rather than the 🗑 emoji: emoji are font-substituted
              to a colour glyph that ignores `currentcolor`, so the hover/focus
              shift to `--danger` would not have applied, and the shape differs
              per platform. Matches the stroke icon style used elsewhere. */}
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 7h16" />
            <path d="M10 4h4a1 1 0 0 1 1 1v2H9V5a1 1 0 0 1 1-1z" />
            <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
            <path d="M10 11v6M14 11v6" />
          </svg>
        </button>
      </div>
    </article>
  );
}
