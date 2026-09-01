import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import type { ApplicationStatus } from "@upgradr/contracts";

import {
  api,
  type ApplicationDetail as ApplicationDetailRecord,
  type ApplicationStatusEvent,
  type ActivityEvent,
  type CompanySummary,
  type ContactSummary,
  type DocumentRecord,
  type LabelSummary,
  type MatchAssessment,
  type NoteSummary,
  type TaskSummary,
} from "./api";
import { StatusMessage } from "./components/Feedback";
import { availableNextStatuses, groupStatusesByStage } from "./lib/applications";
import { describeActivityEvent } from "./lib/activity";
import { isTaskOverdue } from "./lib/tasks";

type DetailState = {
  application: ApplicationDetailRecord;
  statusEvents: ApplicationStatusEvent[];
  matchAssessments: MatchAssessment[];
};

/**
 * The opportunity detail experience: a desktop side panel / mobile
 * full-screen view (see .opportunity-detail-* rules in styles.css) that is
 * deep-linkable at /applications/:id (see lib/routing.ts). Composes the new
 * GET /api/applications/:id endpoint with the existing, already-filterable
 * tasks/notes/documents/companies/contacts/activity endpoints rather than
 * duplicating their fetch/filter logic.
 */
export function OpportunityDetail({
  applicationId,
  onClose,
  onChanged,
}: {
  applicationId: string;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<DetailState>();
  const [loadError, setLoadError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [contacts, setContacts] = useState<ContactSummary[]>([]);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [labels, setLabels] = useState<LabelSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [
        detailResult,
        tasksResult,
        notesResult,
        documentsResult,
        companiesResult,
        contactsResult,
        activityResult,
        labelsResult,
      ] = await Promise.all([
        api.getApplicationDetail(applicationId),
        api.getTasks(),
        api.getNotes({ applicationId }),
        api.getDocuments(),
        api.getCompanies(),
        api.getContacts(),
        api.getActivity({ entityType: "application", entityId: applicationId }),
        api.getLabels(),
      ]);
      setDetail(detailResult);
      setTasks(tasksResult.tasks);
      setNotes(notesResult.notes);
      setDocuments(documentsResult.documents);
      setCompanies(companiesResult.companies);
      setContacts(contactsResult.contacts);
      setActivity(activityResult.events);
      setLabels(labelsResult.labels);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load this opportunity.");
    }
  }, [applicationId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    previousFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [onClose]);

  async function changeStatus(status: ApplicationStatus) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.updateApplicationStatus(applicationId, status);
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update status.");
    } finally {
      setBusy(false);
    }
  }

  async function attachExistingLabel(labelId: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.attachLabel(applicationId, labelId);
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add label.");
    } finally {
      setBusy(false);
    }
  }

  async function createAndAttachLabel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const name = String(form.get("name") ?? "").trim();
    if (!name) {
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const { label } = await api.createLabel({ name });
      await api.attachLabel(applicationId, label.id);
      formElement.reset();
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create label.");
    } finally {
      setBusy(false);
    }
  }

  async function detachLabel(labelId: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.detachLabel(applicationId, labelId);
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove label.");
    } finally {
      setBusy(false);
    }
  }

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const title = String(form.get("title") ?? "").trim();
    if (!title) {
      return;
    }
    const dueAtInput = String(form.get("dueAt") ?? "");
    setBusy(true);
    setMessage(undefined);
    try {
      await api.createTask({
        title,
        applicationId,
        ...(dueAtInput ? { dueAt: new Date(dueAtInput).toISOString() } : {}),
      });
      formElement.reset();
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add follow-up.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleTask(task: TaskSummary) {
    setBusy(true);
    try {
      await api.setTaskCompletion(task.id, !task.is_completed);
      await Promise.all([refresh(), onChanged()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update follow-up.");
    } finally {
      setBusy(false);
    }
  }

  async function createNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = String(form.get("body") ?? "").trim();
    if (!body) {
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      await api.createNote({ body, applicationId });
      formElement.reset();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add note.");
    } finally {
      setBusy(false);
    }
  }

  async function linkDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const documentId = String(form.get("documentId") ?? "");
    if (!documentId) {
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      await api.linkDocument(documentId, { applicationId });
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to link document.");
    } finally {
      setBusy(false);
    }
  }

  async function unlinkDocument(documentId: string, linkId: string) {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.unlinkDocument(documentId, linkId);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to unlink document.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="opportunity-detail-backdrop" onClick={onClose}>
      <aside
        ref={panelRef}
        className="opportunity-detail"
        role="dialog"
        aria-modal="true"
        aria-label="Opportunity detail"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="opportunity-detail-heading">
          <button
            ref={closeButtonRef}
            className="button secondary"
            onClick={onClose}
            aria-label="Close opportunity detail"
          >
            ← Back to board
          </button>
        </div>

        {loadError ? <StatusMessage>{loadError}</StatusMessage> : null}
        {message ? <StatusMessage>{message}</StatusMessage> : null}

        {detail === undefined && !loadError ? <p>Loading opportunity...</p> : null}

        {detail ? (
          <>
            <OverviewSection application={detail.application} />

            <StatusSection
              application={detail.application}
              statusEvents={detail.statusEvents}
              busy={busy}
              onChangeStatus={(status) => void changeStatus(status)}
            />

            <MatchSection application={detail.application} matchAssessments={detail.matchAssessments} />

            <LabelSection
              attached={detail.application.labels}
              allLabels={labels}
              busy={busy}
              onAttach={(labelId) => void attachExistingLabel(labelId)}
              onCreateAndAttach={createAndAttachLabel}
              onDetach={(labelId) => void detachLabel(labelId)}
            />

            <TasksSection
              tasks={tasks.filter((task) => task.application_id === applicationId)}
              busy={busy}
              onCreate={createTask}
              onToggle={(task) => void toggleTask(task)}
            />

            <NotesSection notes={notes} busy={busy} onCreate={createNote} />

            <CompanyContactSection
              application={detail.application}
              companies={companies}
              contacts={contacts}
            />

            <DocumentsSection
              documents={documents}
              applicationId={applicationId}
              busy={busy}
              onLink={linkDocument}
              onUnlink={(documentId, linkId) => void unlinkDocument(documentId, linkId)}
            />

            <ActivitySection events={activity} />
          </>
        ) : null}
      </aside>
    </div>
  );
}

function OverviewSection({ application }: { application: ApplicationDetailRecord }) {
  return (
    <section className="detail-section">
      <p className="eyebrow">Overview</p>
      <h2>{application.title}</h2>
      <p>
        {application.company_name}
        {application.location ? ` · ${application.location}` : ""}
      </p>
      <p>
        <a href={application.source_url} target="_blank" rel="noopener noreferrer">
          View source posting
        </a>{" "}
        · {application.source_provider}
      </p>
      {application.description ? <p className="detail-description">{application.description}</p> : null}
      {application.compensation_min !== null || application.compensation_max !== null ? (
        <p>
          {application.compensation_currency ?? ""} {application.compensation_min ?? "?"}
          {" – "}
          {application.compensation_max ?? "?"}
        </p>
      ) : null}
    </section>
  );
}

function StatusSection({
  application,
  statusEvents,
  busy,
  onChangeStatus,
}: {
  application: ApplicationDetailRecord;
  statusEvents: ApplicationStatusEvent[];
  busy: boolean;
  onChangeStatus: (status: ApplicationStatus) => void;
}) {
  const statusGroups = groupStatusesByStage(availableNextStatuses(application.current_status));

  return (
    <section className="detail-section">
      <p className="eyebrow">Status</p>
      <p className="status">{application.current_status}</p>

      {statusGroups.length > 0 ? (
        <label className="status-control">
          <span>Move to...</span>
          <select
            aria-label="Update opportunity status"
            disabled={busy}
            value=""
            onChange={(event) => {
              const status = event.target.value as ApplicationStatus;
              if (status) {
                onChangeStatus(status);
              }
            }}
          >
            <option value="" disabled>
              Choose a status...
            </option>
            {statusGroups.map((group) => (
              <optgroup label={group.label} key={group.stage}>
                {group.statuses.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
      ) : null}

      {statusEvents.length === 0 ? (
        <p className="detail-empty">No status changes recorded yet.</p>
      ) : (
        <ul className="entity-list">
          {statusEvents.map((event) => (
            <li className="entity-item" key={event.id}>
              <div>
                <strong>
                  {event.from_status ? `${event.from_status} → ${event.to_status}` : event.to_status}
                </strong>
                <span>
                  {event.note ? `${event.note} · ` : ""}
                  {new Date(event.created_at).toLocaleString()}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MatchSection({
  application,
  matchAssessments,
}: {
  application: ApplicationDetailRecord;
  matchAssessments: MatchAssessment[];
}) {
  return (
    <section className="detail-section">
      <p className="eyebrow">Match assessment</p>
      {application.match_score === null ? (
        <p className="detail-empty">No match assessment available for this opportunity.</p>
      ) : (
        <>
          <p>
            <strong>{application.match_score}% match</strong>
            {application.confidence !== null
              ? ` · ${Math.round(application.confidence * 100)}% confidence`
              : ""}
          </p>
          {application.match_rationale ? <p>{application.match_rationale}</p> : null}
          {application.strengths.length > 0 ? (
            <p>Strengths: {application.strengths.join(", ")}</p>
          ) : null}
          {application.gaps.length > 0 ? <p>Gaps: {application.gaps.join(", ")}</p> : null}
        </>
      )}

      {matchAssessments.length > 0 ? (
        <ul className="entity-list">
          {matchAssessments.map((assessment) => (
            <li className="entity-item" key={assessment.id}>
              <div>
                <strong>{assessment.score ?? "?"}% match</strong>
                <span>{new Date(assessment.created_at).toLocaleString()}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function LabelSection({
  attached,
  allLabels,
  busy,
  onAttach,
  onCreateAndAttach,
  onDetach,
}: {
  attached: LabelSummary[];
  allLabels: LabelSummary[];
  busy: boolean;
  onAttach: (labelId: string) => void;
  onCreateAndAttach: (event: FormEvent<HTMLFormElement>) => void;
  onDetach: (labelId: string) => void;
}) {
  const attachedIds = new Set(attached.map((label) => label.id));
  const available = allLabels.filter((label) => !attachedIds.has(label.id));

  return (
    <section className="detail-section">
      <p className="eyebrow">Labels</p>
      {attached.length > 0 ? (
        <div className="label-list">
          {attached.map((label) => (
            <span className="label-chip" key={label.id}>
              {label.name}
              <button
                type="button"
                aria-label={`Remove label ${label.name}`}
                disabled={busy}
                onClick={() => onDetach(label.id)}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="detail-empty">No labels yet.</p>
      )}

      {available.length > 0 ? (
        <label className="status-control">
          <span>Add existing label</span>
          <select
            aria-label="Attach an existing label"
            disabled={busy}
            value=""
            onChange={(event) => {
              const labelId = event.target.value;
              if (labelId) {
                onAttach(labelId);
              }
            }}
          >
            <option value="" disabled>
              Choose a label...
            </option>
            {available.map((label) => (
              <option key={label.id} value={label.id}>
                {label.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <form className="stacked-form" onSubmit={onCreateAndAttach}>
        <div>
          <label htmlFor="newLabelName">New label</label>
          <input id="newLabelName" name="name" maxLength={40} placeholder="Dream job" />
        </div>
        <div className="form-actions">
          <span />
          <button className="button secondary" disabled={busy}>
            Add label
          </button>
        </div>
      </form>
    </section>
  );
}

function TasksSection({
  tasks,
  busy,
  onCreate,
  onToggle,
}: {
  tasks: TaskSummary[];
  busy: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
  onToggle: (task: TaskSummary) => void;
}) {
  return (
    <section className="detail-section">
      <p className="eyebrow">Follow-ups</p>

      <form className="stacked-form" onSubmit={onCreate}>
        <div className="wide">
          <label htmlFor="detailTaskTitle">Task</label>
          <input id="detailTaskTitle" name="title" maxLength={200} placeholder="Send thank-you note" />
        </div>
        <div>
          <label htmlFor="detailTaskDueAt">Due date</label>
          <input id="detailTaskDueAt" name="dueAt" type="date" />
        </div>
        <div className="form-actions wide">
          <span />
          <button className="button secondary" disabled={busy}>
            Add follow-up
          </button>
        </div>
      </form>

      {tasks.length === 0 ? (
        <p className="detail-empty">No follow-ups linked to this opportunity yet.</p>
      ) : (
        <ul className="task-list">
          {tasks.map((task) => (
            <li className={`task-item${task.is_completed ? " completed" : ""}`} key={task.id}>
              <label className="task-checkbox">
                <input
                  type="checkbox"
                  checked={task.is_completed}
                  disabled={busy}
                  onChange={() => onToggle(task)}
                />
                <span>{task.title}</span>
              </label>
              {task.due_at ? (
                <span className={isTaskOverdue(task) ? "task-due overdue" : "task-due"}>
                  {isTaskOverdue(task) ? "Overdue · " : "Due "}
                  {new Date(task.due_at).toLocaleDateString()}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NotesSection({
  notes,
  busy,
  onCreate,
}: {
  notes: NoteSummary[];
  busy: boolean;
  onCreate: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="detail-section">
      <p className="eyebrow">Notes</p>

      <form className="stacked-form" onSubmit={onCreate}>
        <div className="wide">
          <label htmlFor="detailNoteBody">Note</label>
          <textarea id="detailNoteBody" name="body" rows={3} maxLength={8_000} />
        </div>
        <div className="form-actions wide">
          <span />
          <button className="button secondary" disabled={busy}>
            Add note
          </button>
        </div>
      </form>

      {notes.length === 0 ? (
        <p className="detail-empty">No notes yet.</p>
      ) : (
        <ul className="entity-list">
          {notes.map((note) => (
            <li className="entity-item note-item" key={note.id}>
              <div>
                <p className="note-body">{note.body}</p>
                <span>{new Date(note.created_at).toLocaleString()}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CompanyContactSection({
  application,
  companies,
  contacts,
}: {
  application: ApplicationDetailRecord;
  companies: CompanySummary[];
  contacts: ContactSummary[];
}) {
  const company = companies.find((item) => item.id === application.company_id);
  const contact = contacts.find((item) => item.id === application.primary_contact_id);

  return (
    <section className="detail-section">
      <p className="eyebrow">Company & contacts</p>
      {company ? (
        <p>
          <strong>{company.name}</strong>
          {company.website_url ? (
            <>
              {" · "}
              <a href={company.website_url} target="_blank" rel="noopener noreferrer">
                Website
              </a>
            </>
          ) : null}
        </p>
      ) : (
        <p className="detail-empty">No company linked yet.</p>
      )}
      {contact ? (
        <p>
          {contact.full_name}
          {contact.role_title ? ` · ${contact.role_title}` : ""}
          {contact.email ? ` · ${contact.email}` : ""}
        </p>
      ) : (
        <p className="detail-empty">No primary contact linked yet.</p>
      )}
    </section>
  );
}

function DocumentsSection({
  documents,
  applicationId,
  busy,
  onLink,
  onUnlink,
}: {
  documents: DocumentRecord[];
  applicationId: string;
  busy: boolean;
  onLink: (event: FormEvent<HTMLFormElement>) => void;
  onUnlink: (documentId: string, linkId: string) => void;
}) {
  const linked = documents
    .map((document) => ({
      document,
      links: document.links.filter((link) => link.application_id === applicationId),
    }))
    .filter((entry) => entry.links.length > 0);
  const unlinked = documents.filter(
    (document) => !document.links.some((link) => link.application_id === applicationId),
  );

  return (
    <section className="detail-section">
      <p className="eyebrow">Documents</p>
      {linked.length === 0 ? (
        <p className="detail-empty">No documents linked to this opportunity yet.</p>
      ) : (
        <ul className="entity-list">
          {linked.map(({ document, links }) => (
            <li className="entity-item" key={document.id}>
              <div>
                <strong>{document.file_name}</strong>
              </div>
              <div className="entity-item-actions">
                {links.map((link) => (
                  <button
                    key={link.id}
                    type="button"
                    className="button secondary"
                    disabled={busy}
                    onClick={() => onUnlink(document.id, link.id)}
                  >
                    Unlink
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      {unlinked.length > 0 ? (
        <form className="document-link-form" aria-label="Link a document to this opportunity" onSubmit={onLink}>
          <label htmlFor="linkExistingDocument">Link a document</label>
          <select id="linkExistingDocument" name="documentId" defaultValue="">
            <option value="" disabled>
              Choose a document...
            </option>
            {unlinked.map((document) => (
              <option key={document.id} value={document.id}>
                {document.file_name}
              </option>
            ))}
          </select>
          <button className="button secondary" disabled={busy}>
            Link
          </button>
        </form>
      ) : null}
    </section>
  );
}

function ActivitySection({ events }: { events: ActivityEvent[] }) {
  return (
    <section className="detail-section">
      <p className="eyebrow">Activity</p>
      {events.length === 0 ? (
        <p className="detail-empty">No activity recorded yet.</p>
      ) : (
        <ul className="activity-list">
          {events.map((event) => (
            <li className="activity-item" key={event.id}>
              <div>
                <strong>{describeActivityEvent(event)}</strong>
                <span>{new Date(event.created_at).toLocaleString()}</span>
              </div>
              {event.actor !== "user" ? <span className="pill pill-muted">{event.actor}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
