import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { isTerminalStatus } from "@upgradr/domain";


import {
  api,
  type ApplicationSummary,
  type DashboardSummary,
  type SessionUser,
  type TaskSummary,
} from "./api";
import { ActivityTab } from "./ActivityTab";
import { AccountTab } from "./AccountTab";
import { AnalyticsTab } from "./AnalyticsTab";
import { ClosedOpportunitiesTab } from "./ClosedOpportunitiesTab";
import { SuppressionsTab } from "./SuppressionsTab";
import { CompaniesTab } from "./CompaniesTab";
import { ConnectedAgentsTab } from "./ConnectedAgentsTab";
import { ConsentPage } from "./ConsentPage";
import { ContactsTab } from "./ContactsTab";
import { DocumentsTab } from "./DocumentsTab";
import { KanbanBoard } from "./KanbanBoard";
import { NotesTab } from "./NotesTab";
import { OpportunityDetail } from "./OpportunityDetail";
import { PreferencesTab } from "./PreferencesTab";
import { StatusMessage } from "./components/Feedback";
import { useOpportunityRoute } from "./lib/routing";
import { isTaskOverdue } from "./lib/tasks";
import { ProfileImportsTab } from "./ProfileImportsTab";
import { ProfileTab } from "./ProfileTab";

// Top-level workspace sections. Overview is the active Kanban board (the
// default landing content); Summary holds the metrics/recent-opportunities
// content that used to be called "Overview". Profile, Profile imports,
// Preferences, and Account are reachable only through the profile menu (see
// ProfileMenu/profileMenuItems below), and the remaining secondary sections
// live behind the More hub (see MoreSubTab/moreItems), to keep the top-level
// nav from getting crowded.
type DashboardTab = "overview" | "summary" | "more" | "account" | "profile" | "imports";

const dashboardTabs: { id: DashboardTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "summary", label: "Summary" },
  { id: "more", label: "More" },
];

type MoreSubTab =
  | "tasks"
  | "companies"
  | "contacts"
  | "notes"
  | "activity"
  | "documents"
  | "analytics"
  | "agents"
  | "closed"
  | "muted";

const moreItems: { id: MoreSubTab; label: string; description: string }[] = [
  { id: "tasks", label: "Follow-ups", description: "Tasks and reminders tied to your opportunities." },
  { id: "companies", label: "Companies", description: "Organizations you're tracking." },
  { id: "contacts", label: "Contacts", description: "People you're in touch with." },
  { id: "notes", label: "Notes", description: "Freeform notes linked to opportunities." },
  { id: "activity", label: "Activity", description: "A timeline of recent workspace activity." },
  { id: "documents", label: "Documents", description: "Resumes, cover letters, and other files." },
  { id: "analytics", label: "Analytics", description: "Trends across your pipeline." },
  { id: "agents", label: "Connected Agents", description: "MCP clients authorized on your account." },
  { id: "closed", label: "Closed opportunities", description: "Opportunities you've closed out, with their outcome." },
  { id: "muted", label: "Muted sources", description: "Companies and roles that are never proposed again." },
];

type ProfileMenuTab = "profile" | "imports" | "account";

// "imports" (the Profile imports tab: bulk LinkedIn CSV / resume-text
// import) is deliberately hidden from navigation for now -- manual entry and
// "Populate from PDF" on Relevant experience already cover what an agent
// needs (see get_candidate_profile's own docs, which treat relevantExperience
// as the primary evidence source). The route, component, and backend are left
// in place; add the entry back below to re-expose it.
const profileMenuItems: { id: ProfileMenuTab; label: string }[] = [
  { id: "profile", label: "Profile" },
  { id: "account", label: "Account" },
];


const emptyDashboard: DashboardSummary = {
  proposals: 0,
  active: 0,
  overdue: 0,
};

export function App() {
  const isConsentRoute = window.location.pathname === "/oauth/consent";
  const authorizationId = new URLSearchParams(window.location.search).get("authorization_id");
  const [user, setUser] = useState<SessionUser | null | undefined>();
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [applications, setApplications] = useState<ApplicationSummary[]>([]);
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refreshWorkspace = useCallback(async () => {
    const [summary, applicationResult] = await Promise.all([
      api.getDashboard(),
      api.getApplications(),
    ]);
    setDashboard(summary);
    setApplications(applicationResult.applications);
  }, []);

  const checkSession = useCallback(
    async (options?: { background?: boolean }) => {
      try {
        const { user: sessionUser } = await api.getSession();
        setUser(sessionUser);
        if (sessionUser) {
          await refreshWorkspace();
        }
      } catch {
        if (options?.background) {
          // A background re-check (see the effect below) failing -- a
          // transient network blip while a tab regains focus, say -- must
          // not force an already-signed-in user back to the sign-in
          // screen. Leave the current state alone; the next check, or a
          // real reload, will resolve it.
          return;
        }
        setMessage("UpgradR could not load your session.");
        setUser(null);
      }
    },
    [refreshWorkspace],
  );

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  // The initial check above only ever runs once, on mount. A tab left open
  // signed out while the user signs in from another tab, or a tab the
  // browser restores from its back/forward cache with whatever auth state
  // it had when it was last unloaded, neither trigger a fresh network
  // request on their own -- so the tab can keep showing stale auth state
  // (signed in or signed out) until it happens to be reloaded. Re-check
  // whenever the tab becomes visible again or is restored from bfcache, so
  // switching back to an already-open tab is enough to reconcile it.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void checkSession({ background: true });
      }
    }
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        void checkSession({ background: true });
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [checkSession]);

  async function requestMagicLink(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    try {
      const returnTo = isConsentRoute
        ? `${window.location.pathname}${window.location.search}`
        : undefined;
      await api.sendMagicLink(email, returnTo);
      setMessage("Check your inbox for a secure sign-in link.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    try {
      await api.signOut();
      setUser(null);
      setDashboard(emptyDashboard);
      setApplications([]);
    } finally {
      setBusy(false);
    }
  }

  // DELETE /api/account has already removed the account server-side (and
  // cleared its own session cookies) by the time this runs -- just reset
  // local state so the app falls back to the signed-out view, same as
  // signOut() above but without another round trip to /api/auth/sign-out.
  function onAccountDeleted() {
    setUser(null);
    setDashboard(emptyDashboard);
    setApplications([]);
  }

  if (user === undefined) {
    return <main className="centered">Loading UpgradR...</main>;
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="UpgradR home">
          <span className="brand-mark">U</span>
          UpgradR
        </a>
        {user ? (
          <button className="button secondary" disabled={busy} onClick={() => void signOut()}>
            Sign out
          </button>
        ) : null}
      </header>

      <main>
        {user && isConsentRoute && authorizationId ? (
          <ConsentPage authorizationId={authorizationId} />
        ) : user ? (
          <Dashboard
            user={user}
            dashboard={dashboard}
            applications={applications}
            onRefresh={refreshWorkspace}
            onAccountDeleted={onAccountDeleted}
          />
        ) : (
          <section className="hero">
            <div className="hero-copy">
              <p className="eyebrow">Your job search, upgraded</p>
              <h1>Turn scattered opportunities into a focused next move.</h1>
              <p className="lede">
                Organize applications, build a reusable career profile, and let trusted agents
                add sourced job proposals through a secure MCP connection.
              </p>
              <div className="trust-row">
                <span>Private by default</span>
                <span>Every agent action is attributed</span>
                <span>You confirm destructive changes</span>
              </div>
            </div>

            <form className="sign-in-card" onSubmit={(event) => void requestMagicLink(event)}>
              <p className="eyebrow">Start securely</p>
              <h2>{isConsentRoute ? "Sign in to authorize your agent" : "Sign in with email"}</h2>
              <label htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
              <button className="button primary" disabled={busy}>
                {busy ? "Sending..." : "Send magic link"}
              </button>
              {message ? <StatusMessage>{message}</StatusMessage> : null}
            </form>
          </section>
        )}
      </main>
    </div>
  );
}

function Dashboard({
  user,
  dashboard,
  applications,
  onRefresh,
  onAccountDeleted,
}: {
  user: SessionUser;
  dashboard: DashboardSummary;
  applications: ApplicationSummary[];
  onRefresh: () => Promise<void>;
  onAccountDeleted: () => void;
}) {
  const [tab, setTab] = useState<DashboardTab>("overview");
  const [moreSubTab, setMoreSubTab] = useState<MoreSubTab | null>(null);
  const { selectedApplicationId, openApplication, closeApplication } = useOpportunityRoute();

  // A deep link into a closed opportunity's detail should land the user on
  // the Closed opportunities list (under More), not the active board, since
  // the active board never shows closed items. This only runs once per
  // mount, driven by whatever application id was in the URL on load; it
  // waits for `applications` to arrive before deciding.
  const initialDeepLinkId = useRef(selectedApplicationId);
  const deepLinkHandled = useRef(false);

  useEffect(() => {
    if (deepLinkHandled.current) {
      return;
    }
    const id = initialDeepLinkId.current;
    if (!id) {
      deepLinkHandled.current = true;
      return;
    }
    const application = applications.find((entry) => entry.id === id);
    if (!application) {
      return;
    }
    deepLinkHandled.current = true;
    if (isTerminalStatus(application.current_status)) {
      setTab("more");
      setMoreSubTab("closed");
    }
  }, [applications]);

  const activeApplications = applications.filter(
    (application) => !isTerminalStatus(application.current_status),
  );
  const closedApplications = applications.filter((application) =>
    isTerminalStatus(application.current_status),
  );

  function openOpportunity(applicationId: string) {
    openApplication(applicationId);
  }

  function selectTopLevelTab(id: DashboardTab) {
    setTab(id);
    if (id === "more") {
      // Re-entering More via the top nav always returns to the hub; a
      // selected item's own "Back to More" control is the way back from a
      // sub-tab, so the two controls stay predictable and don't fight.
      setMoreSubTab(null);
    }
  }

  return (
    <section className="dashboard">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Keep momentum visible.</h1>
          <p>{user.email ?? "Signed-in account"}</p>
        </div>
        <ProfileMenu activeTab={tab} onSelect={(id) => setTab(id)} />
      </div>

      <nav className="tab-bar" aria-label="Workspace sections">
        {dashboardTabs.map((entry) => (
          <button
            key={entry.id}
            className={`tab${tab === entry.id ? " active" : ""}`}
            aria-current={tab === entry.id ? "page" : undefined}
            onClick={() => selectTopLevelTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <KanbanBoard
          applications={activeApplications}
          closedCount={closedApplications.length}
          onRefresh={onRefresh}
          onOpenApplication={openOpportunity}
          onOpenClosed={() => {
            setTab("more");
            setMoreSubTab("closed");
          }}
        />
      ) : null}
      {tab === "summary" ? <SummaryTab dashboard={dashboard} applications={applications} /> : null}
      {tab === "more" ? (
        moreSubTab === null ? (
          <MoreHub onSelect={setMoreSubTab} />
        ) : (
          <div className="more-detail">
            <button className="more-back" onClick={() => setMoreSubTab(null)}>
              ← Back to More
            </button>
            {moreSubTab === "tasks" ? <TasksTab applications={applications} /> : null}
            {moreSubTab === "companies" ? <CompaniesTab /> : null}
            {moreSubTab === "contacts" ? <ContactsTab /> : null}
            {moreSubTab === "notes" ? <NotesTab applications={applications} /> : null}
            {moreSubTab === "activity" ? <ActivityTab /> : null}
            {moreSubTab === "documents" ? <DocumentsTab applications={applications} /> : null}
            {moreSubTab === "analytics" ? <AnalyticsTab /> : null}
            {moreSubTab === "agents" ? <ConnectedAgentsTab /> : null}
            {moreSubTab === "muted" ? <SuppressionsTab /> : null}
            {moreSubTab === "closed" ? (
              <ClosedOpportunitiesTab
                applications={closedApplications}
                onOpenApplication={openOpportunity}
              />
            ) : null}
          </div>
        )
      ) : null}
      {tab === "profile" ? (
        <>
          <ProfileTab />
          <PreferencesTab />
        </>
      ) : null}
      {tab === "imports" ? <ProfileImportsTab /> : null}
      {tab === "account" ? <AccountTab onAccountDeleted={onAccountDeleted} /> : null}

      {selectedApplicationId ? (
        <OpportunityDetail
          applicationId={selectedApplicationId}
          onClose={closeApplication}
          onChanged={onRefresh}
        />
      ) : null}
    </section>
  );
}

function ProfileMenu({
  activeTab,
  onSelect,
}: {
  activeTab: DashboardTab;
  onSelect: (id: ProfileMenuTab) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    function onDocumentEvent(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent) {
        if (event.key === "Escape") {
          setOpen(false);
        }
        return;
      }
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocumentEvent);
    document.addEventListener("keydown", onDocumentEvent);
    return () => {
      document.removeEventListener("mousedown", onDocumentEvent);
      document.removeEventListener("keydown", onDocumentEvent);
    };
  }, [open]);

  return (
    <div className="profile-menu" ref={containerRef}>
      <button
        type="button"
        className={`profile-menu-trigger${open ? " active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account settings menu"
        onClick={() => setOpen((value) => !value)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24">
          <circle cx="12" cy="8" r="4" />
          <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
        </svg>
      </button>
      {open ? (
        <div className="profile-menu-list" role="menu" aria-label="Account settings">
          {profileMenuItems.map((entry) => (
            <button
              key={entry.id}
              role="menuitem"
              className={`profile-menu-item${activeTab === entry.id ? " active" : ""}`}
              onClick={() => {
                onSelect(entry.id);
                setOpen(false);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function MoreHub({ onSelect }: { onSelect: (id: MoreSubTab) => void }) {
  return (
    <div className="more-hub" aria-label="More workspace sections">
      {moreItems.map((entry) => (
        <button className="more-hub-item" key={entry.id} onClick={() => onSelect(entry.id)}>
          <strong>{entry.label}</strong>
          <span>{entry.description}</span>
        </button>
      ))}
    </div>
  );
}


function SummaryTab({
  dashboard,
  applications,
}: {
  dashboard: DashboardSummary;
  applications: ApplicationSummary[];
}) {
  return (
    <>
      <div className="metric-grid" aria-label="Job search overview">
        <Metric value={dashboard.proposals} label="Agent proposals" tone="violet" />
        <Metric value={dashboard.active} label="Active opportunities" tone="blue" />
        <Metric value={dashboard.overdue} label="Overdue follow-ups" tone="amber" />
      </div>

      <div className="workspace-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">Proposal inbox</p>
              <h2>Review discoveries before they enter your pipeline</h2>
            </div>
            <span className="pill">Source-aware</span>
          </div>
          {applications.length === 0 ? (
            <div className="empty-state">
              <span className="empty-icon">↗</span>
              <h3>No proposals yet</h3>
              <p>Connect an MCP client or add an opportunity manually to get started.</p>
            </div>
          ) : (
            <div className="opportunity-list">
              {applications.slice(0, 8).map((application) => (
                <a
                  className="opportunity"
                  href={application.source_url}
                  key={application.id}
                  rel="noreferrer"
                  target="_blank"
                >
                  <div>
                    <strong>{application.title}</strong>
                    <span>
                      {application.company_name}
                      {application.location ? ` · ${application.location}` : ""}
                    </span>
                  </div>
                  <div className="opportunity-meta">
                    <span className="status">{application.current_status}</span>
                    {application.match_score === null ? null : (
                      <span>{application.match_score}% match</span>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </article>

        <aside className="panel compact">
          <p className="eyebrow">Next setup steps</p>
          <ol className="setup-list">
            <li>Complete your candidate profile</li>
            <li>Set role and location preferences</li>
            <li>Connect a trusted agent</li>
          </ol>
        </aside>
      </div>
    </>
  );
}

function TasksTab({ applications }: { applications: ApplicationSummary[] }) {
  const [tasks, setTasks] = useState<TaskSummary[]>();
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const { tasks: loaded } = await api.getTasks();
      setTasks(loaded);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load follow-ups.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function createTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setSaving(true);
    setMessage(undefined);

    try {
      const dueAtInput = String(form.get("dueAt") ?? "");
      const applicationId = String(form.get("applicationId") ?? "");
      await api.createTask({
        title: String(form.get("title") ?? ""),
        ...(dueAtInput ? { dueAt: new Date(dueAtInput).toISOString() } : {}),
        ...(applicationId ? { applicationId } : {}),
      });
      formElement.reset();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add follow-up task.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleCompletion(task: TaskSummary) {
    setTogglingId(task.id);
    try {
      await api.setTaskCompletion(task.id, !task.is_completed);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update follow-up task.");
    } finally {
      setTogglingId(undefined);
    }
  }

  return (
    <>
      <div className="panel-heading panel-heading-spaced">
        <div>
          <p className="eyebrow">Follow-ups</p>
          <h2>Keep every next step accounted for</h2>
        </div>
      </div>

      <form className="task-form panel" onSubmit={(event) => void createTask(event)}>
        <div className="wide">
          <label htmlFor="taskTitle">Task</label>
          <input id="taskTitle" name="title" required maxLength={200} placeholder="Send thank-you note" />
        </div>
        <div>
          <label htmlFor="taskDueAt">Due date</label>
          <input id="taskDueAt" name="dueAt" type="date" />
        </div>
        <div>
          <label htmlFor="taskApplicationId">Linked opportunity</label>
          <select id="taskApplicationId" name="applicationId" defaultValue="">
            <option value="">None</option>
            {applications.map((application) => (
              <option key={application.id} value={application.id}>
                {application.title} · {application.company_name}
              </option>
            ))}
          </select>
        </div>
        <div className="form-actions wide">
          {message ? <StatusMessage>{message}</StatusMessage> : <span />}
          <button className="button primary" disabled={saving}>
            {saving ? "Adding..." : "Add follow-up"}
          </button>
        </div>
      </form>

      <article className="panel">
        {tasks === undefined ? (
          <p>Loading follow-ups...</p>
        ) : tasks.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">✓</span>
            <h3>No follow-ups yet</h3>
            <p>Add a task above to keep track of what comes next.</p>
          </div>
        ) : (
          <ul className="task-list">
            {tasks.map((task) => (
              <li className={`task-item${task.is_completed ? " completed" : ""}`} key={task.id}>
                <label className="task-checkbox">
                  <input
                    type="checkbox"
                    checked={task.is_completed}
                    disabled={togglingId === task.id}
                    onChange={() => void toggleCompletion(task)}
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
      </article>
    </>
  );
}

function Metric({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "violet" | "blue" | "amber";
}) {
  return (
    <article className={`metric ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </article>
  );
}
