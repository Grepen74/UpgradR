import type { ApplicationSummary } from "./api";

/**
 * Closed opportunities list, reachable from More. Shows the outcome each
 * item was closed with and a useful summary, and opens the same
 * OpportunityDetail overlay/deep link used everywhere else (via
 * onOpenApplication) -- the active board excludes everything shown here.
 */
export function ClosedOpportunitiesTab({
  applications,
  onOpenApplication,
}: {
  applications: ApplicationSummary[];
  onOpenApplication: (applicationId: string) => void;
}) {
  return (
    <article className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Closed opportunities</p>
          <h2>Opportunities you've closed out</h2>
        </div>
        <span className="pill">{applications.length}</span>
      </div>

      {applications.length === 0 ? (
        <div className="empty-state">
          <span className="empty-icon">✓</span>
          <h3>Nothing closed yet</h3>
          <p>
            Opportunities you close with an outcome (accepted, rejected, withdrawn, dismissed, or
            archived) will show up here, off the active board.
          </p>
        </div>
      ) : (
        <div className="opportunity-list">
          {applications.map((application) => (
            <button
              className="opportunity"
              key={application.id}
              onClick={() => onOpenApplication(application.id)}
            >
              <div>
                <strong>{application.title}</strong>
                <span>
                  {application.company_name}
                  {application.location ? ` · ${application.location}` : ""}
                </span>
              </div>
              <div className="opportunity-meta">
                <span className="status pill-capitalize">{application.current_status}</span>
                <span>Updated {new Date(application.updated_at).toLocaleDateString()}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}
