import { useCallback, useEffect, useState } from "react";

import type { McpScopeDescriptor } from "@upgradr/contracts";

import { api, type OAuthGrant } from "./api";
import { ConfirmButton, StatusMessage } from "./components/Feedback";

export function ConnectedAgentsTab() {
  const [grants, setGrants] = useState<OAuthGrant[]>();
  const [catalog, setCatalog] = useState<McpScopeDescriptor[]>([]);
  const [message, setMessage] = useState<string>();
  const [revokingId, setRevokingId] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const { grants: loaded, scopeCatalog } = await api.getOAuthGrants();
      setGrants(loaded);
      setCatalog(scopeCatalog ?? []);
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
                <AgentScopeEditor
                  catalog={catalog}
                  grant={grant}
                  onSaved={refresh}
                  onError={setMessage}
                />
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

/**
 * Permissions stay editable after connecting so tightening or extending an
 * agent's access does not force the user to disconnect and re-authorize it.
 * A saved change takes effect when the agent next refreshes its token.
 */
function AgentScopeEditor({
  catalog,
  grant,
  onSaved,
  onError,
}: {
  catalog: McpScopeDescriptor[];
  grant: OAuthGrant;
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<string[]>(grant.scopes);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelected(grant.scopes);
  }, [grant.scopes]);

  if (!editing) {
    return (
      <div className="scope-summary">
        <div className="scope-list" aria-label="Granted permissions">
          {grant.scopes.length === 0 ? (
            <span>No permissions granted</span>
          ) : (
            grant.scopes.map((scope) => (
              <span key={scope}>
                {catalog.find((entry) => entry.scope === scope)?.label ?? scope}
              </span>
            ))
          )}
        </div>
        <button className="button ghost" onClick={() => setEditing(true)}>
          Edit permissions
        </button>
      </div>
    );
  }

  async function save() {
    setSaving(true);
    try {
      await api.updateOAuthGrantScopes(grant.clientId, selected);
      setEditing(false);
      await onSaved();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Unable to update agent permissions.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <fieldset className="scope-picker compact">
      <legend>Permissions</legend>
      {catalog.map((entry) => (
        <label className={`scope-option${entry.sensitive ? " sensitive" : ""}`} key={entry.scope}>
          <input
            type="checkbox"
            checked={entry.required || selected.includes(entry.scope)}
            disabled={entry.required || saving}
            onChange={(event) => {
              // Read the checkbox before handing control to the updater: React
              // runs that callback during the next render, by which point the
              // synthetic event's currentTarget is null.
              const { checked } = event.currentTarget;
              setSelected((current) =>
                checked
                  ? [...new Set([...current, entry.scope])]
                  : current.filter((value) => value !== entry.scope),
              );
            }}
          />
          <span>
            <strong>
              {entry.label}
              {entry.sensitive ? <em className="scope-flag">Sensitive</em> : null}
            </strong>
            <span className="scope-description">{entry.description}</span>
          </span>
        </label>
      ))}
      <div className="scope-actions">
        <button
          className="button secondary"
          disabled={saving}
          onClick={() => {
            setSelected(grant.scopes);
            setEditing(false);
          }}
        >
          Cancel
        </button>
        <button className="button primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving..." : "Save permissions"}
        </button>
      </div>
    </fieldset>
  );
}

