import { applicationStatuses } from "@upgradr/contracts";
import { useCallback, useEffect, useState } from "react";

import {
  api,
  type AnalyticsNextAction,
  type AnalyticsOverdueTask,
  type AnalyticsOverview,
  type AnalyticsStaleApplication,
} from "./api";
import { StatusMessage } from "./components/Feedback";
import { daysSince, formatDays, formatRate, formatWeekLabel, maxCount } from "./lib/analytics";

const WEEK_OPTIONS = [4, 8, 12, 26, 52];
const STALE_DAY_OPTIONS = [7, 14, 30, 60];
const REVIEW_LIST_LIMIT = 10;

export function AnalyticsTab() {
  const [weeks, setWeeks] = useState(12);
  const [staleDays, setStaleDays] = useState(14);
  const [overview, setOverview] = useState<AnalyticsOverview>();
  const [nextActions, setNextActions] = useState<AnalyticsNextAction[]>();
  const [staleApplications, setStaleApplications] = useState<AnalyticsStaleApplication[]>();
  const [overdueTasks, setOverdueTasks] = useState<AnalyticsOverdueTask[]>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const [overviewResult, nextActionsResult, staleResult, overdueResult] = await Promise.all([
        api.getAnalyticsOverview({ weeks, staleDays }),
        api.getAnalyticsNextActions(REVIEW_LIST_LIMIT),
        api.getAnalyticsStaleApplications({ staleDays, limit: REVIEW_LIST_LIMIT }),
        api.getAnalyticsOverdueTasks(REVIEW_LIST_LIMIT),
      ]);
      setOverview(overviewResult.overview);
      setNextActions(nextActionsResult.applications);
      setStaleApplications(staleResult.applications);
      setOverdueTasks(overdueResult.tasks);
      setMessage(undefined);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load analytics.");
    } finally {
      setBusy(false);
    }
  }, [weeks, staleDays]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pipelineEntries = applicationStatuses
    .map((status) => ({ status, count: overview?.pipeline[status] ?? 0 }))
    .filter((entry) => entry.count > 0);
  const pipelineMax = maxCount(pipelineEntries);
  const weekMax = maxCount(overview?.applicationsOverTime ?? []);
  const sourceMax = maxCount(overview?.sourceBreakdown ?? []);

  return (
    <div className="analytics-tab">
      <div className="panel-heading panel-heading-spaced">
        <div>
          <p className="eyebrow">Analytics &amp; weekly review</p>
          <h2>See what is moving, and what needs a next action</h2>
        </div>
        <div className="analytics-controls">
          <label>
            <span className="sr-only">Trend window</span>
            <select
              aria-label="Trend window in weeks"
              value={weeks}
              onChange={(event) => setWeeks(Number(event.target.value))}
            >
              {WEEK_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option} weeks
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">Stale threshold</span>
            <select
              aria-label="Stale threshold in days"
              value={staleDays}
              onChange={(event) => setStaleDays(Number(event.target.value))}
            >
              {STALE_DAY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  Stale after {option}d
                </option>
              ))}
            </select>
          </label>
          <button className="button secondary" disabled={busy} onClick={() => void refresh()}>
            {busy ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {message ? <StatusMessage>{message}</StatusMessage> : null}

      {!overview ? (
        <p>Loading analytics...</p>
      ) : (
        <>
          <div className="metric-grid" aria-label="Weekly review highlights">
            <Metric value={overview.staleApplicationCount} label="Stale opportunities" tone="amber" />
            <Metric value={overview.overdueTaskCount} label="Overdue follow-ups" tone="blue" />
            <Metric
              value={formatRate(overview.followUp.completionRate)}
              label={`Follow-up completion (${overview.followUp.completedCount}/${overview.followUp.totalCount})`}
              tone="violet"
            />
          </div>

          <div className="workspace-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Conversion</p>
                  <h2>Proposal to shortlist to applied</h2>
                </div>
              </div>
              <ul className="funnel-list" aria-label="Conversion funnel">
                <li>
                  <span>Proposed</span>
                  <strong>{overview.conversion.proposedCount}</strong>
                </li>
                <li>
                  <span>
                    → Shortlisted{" "}
                    <em>({formatRate(overview.conversion.proposalToShortlistRate)})</em>
                  </span>
                  <strong>{overview.conversion.shortlistedCount}</strong>
                </li>
                <li>
                  <span>
                    → Applied{" "}
                    <em>({formatRate(overview.conversion.shortlistToAppliedRate)})</em>
                  </span>
                  <strong>{overview.conversion.appliedCount}</strong>
                </li>
              </ul>
            </article>

            <article className="panel compact">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Pipeline</p>
                  <h2>By status</h2>
                </div>
              </div>
              {pipelineEntries.length === 0 ? (
                <p>No applications yet.</p>
              ) : (
                <ul className="bar-list" aria-label="Applications by status">
                  {pipelineEntries.map((entry) => (
                    <li key={entry.status}>
                      <span>{entry.status}</span>
                      <progress
                        className="bar-progress"
                        aria-label={`${entry.status}: ${entry.count}`}
                        value={entry.count}
                        max={pipelineMax}
                      />
                      <strong>{entry.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          <div className="workspace-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Trend</p>
                  <h2>Applications added per week</h2>
                </div>
              </div>
              {overview.applicationsOverTime.every((week) => week.count === 0) ? (
                <p>No applications in this window yet.</p>
              ) : (
                <ul className="bar-list" aria-label="Applications added per week">
                  {overview.applicationsOverTime.map((week) => (
                    <li key={week.weekStart}>
                      <span>{formatWeekLabel(week.weekStart)}</span>
                      <progress
                        className="bar-progress"
                        aria-label={`${formatWeekLabel(week.weekStart)}: ${week.count}`}
                        value={week.count}
                        max={weekMax}
                      />
                      <strong>{week.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="panel compact">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Sources</p>
                  <h2>Where opportunities come from</h2>
                </div>
              </div>
              {overview.sourceBreakdown.length === 0 ? (
                <p>No applications yet.</p>
              ) : (
                <ul className="bar-list" aria-label="Applications by source">
                  {overview.sourceBreakdown.map((source) => (
                    <li key={source.sourceProvider}>
                      <span>{source.sourceProvider}</span>
                      <progress
                        className="bar-progress"
                        aria-label={`${source.sourceProvider}: ${source.count}`}
                        value={source.count}
                        max={sourceMax}
                      />
                      <strong>{source.count}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Time in stage</p>
                <h2>Average days spent, where an exit was observed</h2>
              </div>
            </div>
            {overview.timeInStageDays.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">⏱</span>
                <h3>Not enough history yet</h3>
                <p>
                  Time-in-stage only counts once an application has moved on to a new status, so
                  the average has a real end time to measure.
                </p>
              </div>
            ) : (
              <ul className="entity-list">
                {overview.timeInStageDays.map((stage) => (
                  <li className="entity-item" key={stage.status}>
                    <div>
                      <strong>{stage.status}</strong>
                      <span>{stage.sampleSize} observed</span>
                    </div>
                    <strong>{formatDays(stage.avgDays)}</strong>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <div className="workspace-grid">
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Weekly review</p>
                  <h2>Needs a next action</h2>
                </div>
              </div>
              {!nextActions || nextActions.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">✓</span>
                  <h3>Every active opportunity has a next step</h3>
                  <p>Nothing here needs a follow-up task right now.</p>
                </div>
              ) : (
                <ul className="entity-list">
                  {nextActions.map((application) => (
                    <li className="entity-item" key={application.application_id}>
                      <div>
                        <strong>{application.title}</strong>
                        <span>
                          {application.company_name} · {application.current_status}
                        </span>
                      </div>
                      <span>Updated {daysSince(application.updated_at)}d ago</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <article className="panel compact">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Weekly review</p>
                  <h2>Stale opportunities</h2>
                </div>
              </div>
              {!staleApplications || staleApplications.length === 0 ? (
                <p>Nothing has gone quiet in the last {staleDays} days.</p>
              ) : (
                <ul className="entity-list">
                  {staleApplications.map((application) => (
                    <li className="entity-item" key={application.id}>
                      <div>
                        <strong>{application.title}</strong>
                        <span>
                          {application.company_name} · {application.current_status}
                        </span>
                      </div>
                      <span>{daysSince(application.updated_at)}d quiet</span>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Weekly review</p>
                <h2>Overdue follow-ups</h2>
              </div>
            </div>
            {!overdueTasks || overdueTasks.length === 0 ? (
              <div className="empty-state">
                <span className="empty-icon">✓</span>
                <h3>No overdue follow-ups</h3>
                <p>Every follow-up task is either done or still on time.</p>
              </div>
            ) : (
              <ul className="task-list">
                {overdueTasks.map((task) => (
                  <li className="task-item" key={task.id}>
                    <span>{task.title}</span>
                    <span className="task-due overdue">
                      Due {task.due_at ? new Date(task.due_at).toLocaleDateString() : "unknown"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </>
      )}
    </div>
  );
}

function Metric({
  value,
  label,
  tone,
}: {
  value: number | string;
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
