import { useEffect, useState } from "react";

import { api, type OAuthAuthorization } from "./api";
import { StatusMessage } from "./components/Feedback";

export function ConsentPage({ authorizationId }: { authorizationId: string }) {
  const [authorization, setAuthorization] = useState<OAuthAuthorization>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    void api
      .getOAuthAuthorization(authorizationId)
      .then((value) => {
        if (value.redirectUrl) {
          window.location.assign(value.redirectUrl);
          return;
        }
        setAuthorization(value);
        setSelected(value.defaultScopes ?? []);
      })
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "Unable to load authorization.");
      });
  }, [authorizationId]);

  const catalog = authorization?.scopeCatalog ?? [];

  function toggle(scope: string, enabled: boolean) {
    setSelected((current) =>
      enabled ? [...new Set([...current, scope])] : current.filter((value) => value !== scope),
    );
  }

  async function decide(decision: "approve" | "deny") {
    setBusy(true);
    setMessage(undefined);
    try {
      const result = await api.decideOAuthAuthorization(authorizationId, decision, selected);
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
          Choose exactly what this agent may do. You can change these permissions or disconnect
          it at any time from Connected agents.
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

            <fieldset className="scope-picker">
              <legend>Permissions</legend>
              {catalog.map((entry) => (
                <label
                  className={`scope-option${entry.sensitive ? " sensitive" : ""}`}
                  key={entry.scope}
                >
                  <input
                    type="checkbox"
                    checked={entry.required || selected.includes(entry.scope)}
                    disabled={entry.required || busy}
                    onChange={(event) => toggle(entry.scope, event.currentTarget.checked)}
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
            </fieldset>

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
