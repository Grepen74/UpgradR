import { useCallback, useEffect, useState, type FormEvent } from "react";

import {
  api,
  type ApplicationSummary,
  type CandidateProfile,
  type DashboardSummary,
  type JobSearchPreferences,
  type OAuthAuthorization,
  type OAuthGrant,
  type SessionUser,
  type TaskSummary,
} from "./api";
import { ActivityTab } from "./ActivityTab";
import { AccountTab } from "./AccountTab";
import { AnalyticsTab } from "./AnalyticsTab";
import { CompaniesTab } from "./CompaniesTab";
import { ContactsTab } from "./ContactsTab";
import { DocumentsTab } from "./DocumentsTab";
import { KanbanBoard } from "./KanbanBoard";
import { NotesTab } from "./NotesTab";
import { OpportunityDetail } from "./OpportunityDetail";
import { ConfirmButton, StatusMessage } from "./components/Feedback";
import { isApplicationsRoute, useOpportunityRoute } from "./lib/routing";
import { formatCommaList, parseCommaList } from "./lib/preferences";
import { isTaskOverdue } from "./lib/tasks";
import { ProfileImportsTab } from "./ProfileImportsTab";

type DashboardTab =
  | "overview"
  | "applications"
  | "tasks"
  | "companies"
  | "contacts"
  | "notes"
  | "activity"
  | "documents"
  | "analytics"
  | "profile"
  | "imports"
  | "preferences"
  | "agents"
  | "account";

const dashboardTabs: { id: DashboardTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "applications", label: "Applications" },
  { id: "tasks", label: "Follow-ups" },
  { id: "companies", label: "Companies" },
  { id: "contacts", label: "Contacts" },
  { id: "notes", label: "Notes" },
  { id: "activity", label: "Activity" },
  { id: "documents", label: "Documents" },
  { id: "analytics", label: "Analytics" },
  { id: "profile", label: "Profile" },
  { id: "imports", label: "Profile imports" },
  { id: "preferences", label: "Preferences" },
  { id: "agents", label: "Connected agents" },
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

  useEffect(() => {
    void api
      .getSession()
      .then(async ({ user: sessionUser }) => {
        setUser(sessionUser);
        if (sessionUser) {
          await refreshWorkspace();
        }
      })
      .catch(() => {
        setMessage("UpgradR could not load your session.");
        setUser(null);
      });
  }, [refreshWorkspace]);

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

function ConsentPage({ authorizationId }: { authorizationId: string }) {
  const [authorization, setAuthorization] = useState<OAuthAuthorization>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .getOAuthAuthorization(authorizationId)
      .then((value) => {
        if (value.redirectUrl) {
          window.location.assign(value.redirectUrl);
          return;
        }
        setAuthorization(value);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Unable to load authorization.");
      });
  }, [authorizationId]);

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api.decideOAuthAuthorization(authorizationId, decision);
      window.location.assign(result.redirectUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to complete authorization.");
      setBusy(false);
    }
  }

  return (
    <section className="consent-layout">
      <article className="consent-card">
        <p className="eyebrow">Agent connection</p>
        <h1>Authorize {authorization?.client?.name ?? "this MCP client"}?</h1>
        <p className="lede">
          Review the exact access being requested. You can revoke a connected client from
          settings later.
        </p>

        {authorization ? (
          <>
            <dl className="consent-details">
              <div>
                <dt>Client</dt>
                <dd>{authorization.client?.name ?? "Unknown client"}</dd>
              </div>
              <div>
                <dt>Redirect</dt>
                <dd>{authorization.client?.redirectUri ?? "Not provided"}</dd>
              </div>
            </dl>

            <div className="scope-list" aria-label="Requested permissions">
              {(authorization.scopes ?? []).map((scope) => (
                <span key={scope}>{scope}</span>
              ))}
            </div>

            <div className="consent-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => void decide("deny")}
              >
                Deny
              </button>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void decide("approve")}
              >
                Approve access
              </button>
            </div>
          </>
        ) : message ? (
          <StatusMessage>{message}</StatusMessage>
        ) : (
          <p>Loading authorization request...</p>
        )}
      </article>
    </section>
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
  const [tab, setTab] = useState<DashboardTab>(() =>
    isApplicationsRoute() ? "applications" : "overview",
  );
  const { selectedApplicationId, openApplication, closeApplication } = useOpportunityRoute();

  function openOpportunity(applicationId: string) {
    setTab("applications");
    openApplication(applicationId);
  }

  return (
    <section className="dashboard">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Keep momentum visible.</h1>
          <p>{user.email ?? "Signed-in account"}</p>
        </div>
      </div>

      <nav className="tab-bar" aria-label="Workspace sections">
        {dashboardTabs.map((entry) => (
          <button
            key={entry.id}
            className={`tab${tab === entry.id ? " active" : ""}`}
            aria-current={tab === entry.id ? "page" : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <OverviewTab dashboard={dashboard} applications={applications} />
      ) : null}
      {tab === "applications" ? (
        <KanbanBoard
          applications={applications}
          onRefresh={onRefresh}
          onOpenApplication={openOpportunity}
        />
      ) : null}
      {tab === "tasks" ? <TasksTab applications={applications} /> : null}
      {tab === "companies" ? <CompaniesTab /> : null}
      {tab === "contacts" ? <ContactsTab /> : null}
      {tab === "notes" ? <NotesTab applications={applications} /> : null}
      {tab === "activity" ? <ActivityTab /> : null}
      {tab === "documents" ? <DocumentsTab applications={applications} /> : null}
      {tab === "analytics" ? <AnalyticsTab /> : null}
      {tab === "profile" ? <ProfileTab /> : null}
      {tab === "imports" ? <ProfileImportsTab /> : null}
      {tab === "preferences" ? <PreferencesTab /> : null}
      {tab === "agents" ? <ConnectedAgentsTab /> : null}
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

function OverviewTab({
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

function ProfileTab() {
  const [profile, setProfile] = useState<CandidateProfile>();
  const [headline, setHeadline] = useState("");
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getProfile()
      .then(({ profile: loaded }) => {
        setProfile(loaded);
        setHeadline(loaded.headline ?? "");
        setSummary(loaded.summary ?? "");
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Unable to load candidate profile.");
      });
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);

    try {
      const { profile: saved } = await api.updateProfile({
        headline: headline.trim() ? headline.trim() : null,
        summary: summary.trim() ? summary.trim() : null,
      });
      setProfile(saved);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save candidate profile.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Candidate profile</p>
          <h2>How you're introduced to opportunities</h2>
        </div>
        {profile ? (
          <span className={`pill${profile.is_confirmed ? "" : " pill-muted"}`}>
            {profile.is_confirmed ? "Reviewed" : "Needs review"}
          </span>
        ) : null}
      </div>

      {profile === undefined ? (
        <p>Loading profile...</p>
      ) : (
        <form className="stacked-form" onSubmit={(event) => void save(event)}>
          <div>
            <label htmlFor="headline">Headline</label>
            <input
              id="headline"
              maxLength={240}
              value={headline}
              onChange={(event) => setHeadline(event.target.value)}
              placeholder="Senior iOS Engineer"
            />
          </div>
          <div>
            <label htmlFor="summary">Summary</label>
            <textarea
              id="summary"
              rows={6}
              maxLength={8_000}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              placeholder="A short summary of your experience and what you're looking for next."
            />
          </div>
          <div className="form-actions">
            {message ? (
              <StatusMessage>{message}</StatusMessage>
            ) : profile.last_reviewed_at ? (
              <StatusMessage>
                Last reviewed {new Date(profile.last_reviewed_at).toLocaleDateString()}
              </StatusMessage>
            ) : (
              <span />
            )}
            <button className="button primary" disabled={saving}>
              {saving ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

const emptyPreferences: JobSearchPreferences = {
  targetRoles: [],
  locations: [],
  remotePolicy: "flexible",
  minimumCompensation: null,
  compensationCurrency: null,
  industries: [],
  excludedCompanies: [],
  notes: null,
};

function PreferencesTab() {
  const [preferences, setPreferences] = useState<JobSearchPreferences>();
  const [form, setForm] = useState(emptyPreferences);
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void api
      .getPreferences()
      .then((loaded) => {
        setPreferences(loaded);
        setForm(loaded);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Unable to load job preferences.");
      });
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);

    try {
      await api.updatePreferences(form);
      setPreferences(form);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save job preferences.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Job search preferences</p>
          <h2>What agents should look for on your behalf</h2>
        </div>
      </div>

      {preferences === undefined ? (
        <p>Loading preferences...</p>
      ) : (
        <form className="stacked-form" onSubmit={(event) => void save(event)}>
          <div>
            <label htmlFor="targetRoles">Target roles (comma-separated)</label>
            <input
              id="targetRoles"
              value={formatCommaList(form.targetRoles)}
              onChange={(event) =>
                setForm((value) => ({ ...value, targetRoles: parseCommaList(event.target.value) }))
              }
            />
          </div>
          <div>
            <label htmlFor="locations">Locations (comma-separated)</label>
            <input
              id="locations"
              value={formatCommaList(form.locations)}
              onChange={(event) =>
                setForm((value) => ({ ...value, locations: parseCommaList(event.target.value) }))
              }
            />
          </div>
          <div>
            <label htmlFor="remotePolicy">Remote policy</label>
            <select
              id="remotePolicy"
              value={form.remotePolicy}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  remotePolicy: event.target.value as JobSearchPreferences["remotePolicy"],
                }))
              }
            >
              <option value="onsite">Onsite</option>
              <option value="hybrid">Hybrid</option>
              <option value="remote">Remote</option>
              <option value="flexible">Flexible</option>
            </select>
          </div>
          <div>
            <label htmlFor="minimumCompensation">Minimum compensation</label>
            <input
              id="minimumCompensation"
              type="number"
              min={0}
              value={form.minimumCompensation ?? ""}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  minimumCompensation: event.target.value === "" ? null : Number(event.target.value),
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="compensationCurrency">Currency (3 letters)</label>
            <input
              id="compensationCurrency"
              maxLength={3}
              value={form.compensationCurrency ?? ""}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  compensationCurrency: event.target.value ? event.target.value : null,
                }))
              }
            />
          </div>
          <div>
            <label htmlFor="industries">Industries (comma-separated)</label>
            <input
              id="industries"
              value={formatCommaList(form.industries)}
              onChange={(event) =>
                setForm((value) => ({ ...value, industries: parseCommaList(event.target.value) }))
              }
            />
          </div>
          <div className="wide">
            <label htmlFor="excludedCompanies">Excluded companies (comma-separated)</label>
            <input
              id="excludedCompanies"
              value={formatCommaList(form.excludedCompanies)}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  excludedCompanies: parseCommaList(event.target.value),
                }))
              }
            />
          </div>
          <div className="wide">
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              rows={4}
              maxLength={4_000}
              value={form.notes ?? ""}
              onChange={(event) =>
                setForm((value) => ({
                  ...value,
                  notes: event.target.value ? event.target.value : null,
                }))
              }
            />
          </div>
          <div className="form-actions wide">
            {message ? <StatusMessage>{message}</StatusMessage> : <span />}
            <button className="button primary" disabled={saving}>
              {saving ? "Saving..." : "Save preferences"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

function ConnectedAgentsTab() {
  const [grants, setGrants] = useState<OAuthGrant[]>();
  const [message, setMessage] = useState<string>();
  const [revokingId, setRevokingId] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const { grants: loaded } = await api.getOAuthGrants();
      setGrants(loaded);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load connected agents.");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function revoke(clientId: string) {
    setRevokingId(clientId);
    setMessage(undefined);
    try {
      await api.revokeOAuthGrant(clientId);
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to revoke agent access.");
    } finally {
      setRevokingId(undefined);
    }
  }

  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Connected agents</p>
          <h2>Trusted MCP clients with access to your workspace</h2>
        </div>
      </div>

      {message ? <StatusMessage>{message}</StatusMessage> : null}

      {grants === undefined ? (
        <p>Loading connected agents...</p>
      ) : grants.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">⌘</span>
          <h3>No connected agents</h3>
          <p>When you authorize an MCP client, it will appear here with the access it was granted.</p>
        </div>
      ) : (
        <ul className="agent-list">
          {grants.map((grant) => (
            <li className="agent-item" key={grant.clientId}>
              <div>
                <strong>{grant.clientName}</strong>
                <span>Connected {new Date(grant.grantedAt).toLocaleDateString()}</span>
                <div className="scope-list" aria-label="Granted permissions">
                  {grant.scopes.map((scope) => (
                    <span key={scope}>{scope}</span>
                  ))}
                </div>
              </div>
              <ConfirmButton
                className="button secondary"
                disabled={revokingId === grant.clientId}
                confirmLabel="Confirm revoke access"
                onConfirm={() => revoke(grant.clientId)}
              >
                {revokingId === grant.clientId ? "Revoking..." : "Revoke access"}
              </ConfirmButton>
            </li>
          ))}
        </ul>
      )}
    </article>
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
