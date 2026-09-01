import { useCallback, useEffect, useState } from "react";

import { api, type ActivityEntityType, type ActivityEvent } from "./api";
import { StatusMessage } from "./components/Feedback";
import { describeActivityEvent } from "./lib/activity";

const FILTERS: { id: ActivityEntityType | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "application", label: "Opportunities" },
  { id: "company", label: "Companies" },
  { id: "contact", label: "Contacts" },
  { id: "task", label: "Follow-ups" },
  { id: "note", label: "Notes" },
];

export function ActivityTab() {
  const [events, setEvents] = useState<ActivityEvent[]>();
  const [message, setMessage] = useState<string>();
  const [filter, setFilter] = useState<ActivityEntityType | "all">("all");

  const refresh = useCallback(async (entityType: ActivityEntityType | "all") => {
    try {
      const { events: loaded } = await api.getActivity(
        entityType === "all" ? undefined : { entityType },
      );
      setEvents(loaded);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load activity.");
    }
  }, []);

  useEffect(() => {
    void refresh(filter);
  }, [refresh, filter]);

  return (
    <div className="activity-tab">
      <div className="panel-heading panel-heading-spaced">
        <div>
          <p className="eyebrow">Activity</p>
          <h2>A unified timeline of everything that changed</h2>
        </div>
      </div>

      <div className="tab-bar" aria-label="Filter activity by type">
        {FILTERS.map((entry) => (
          <button
            key={entry.id}
            className={`tab${filter === entry.id ? " active" : ""}`}
            aria-current={filter === entry.id ? "page" : undefined}
            onClick={() => setFilter(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <article className="panel">
        {message ? <StatusMessage>{message}</StatusMessage> : null}
        {events === undefined ? (
          <p>Loading activity...</p>
        ) : events.length === 0 ? (
          <div className="empty-state">
            <span className="empty-icon">◷</span>
            <h3>No activity yet</h3>
            <p>Actions you and your connected agents take will show up here as they happen.</p>
          </div>
        ) : (
          <ul className="activity-list">
            {events.map((event) => (
              <li className="activity-item" key={event.id}>
                <div>
                  <strong>{describeActivityEvent(event)}</strong>
                  <span>{new Date(event.created_at).toLocaleString()}</span>
                </div>
                {event.actor !== "user" ? (
                  <span className="pill pill-muted">{event.actor}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}
