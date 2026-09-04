import { useCallback, useEffect, useState } from "react";

import {
  suppressionExpiresByDefault,
  suppressionKeyTypeLabels,
  suppressionSourceLabels,
  type SuppressionKeyType,
} from "@upgradr/contracts";

import { api, type SuppressionSummary } from "./api";

// A reviewable, reversible list of what the user has asked never to see again.
//
// Suppressions accumulate quietly -- closing an opportunity as rejected adds
// one -- so leaving them invisible would mean an agent silently proposing less
// over time with no way for the user to find out why. Everything here is
// removable for that reason.

function describeExpiry(suppression: SuppressionSummary): string {
  if (!suppression.expires_at) {
    return "Permanent";
  }

  const expires = new Date(suppression.expires_at);
  const days = Math.ceil((expires.getTime() - Date.now()) / 86_400_000);
  return days <= 0 ? "Expired" : `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

export function SuppressionsTab() {
  const [suppressions, setSuppressions] = useState<SuppressionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [keyType, setKeyType] = useState<SuppressionKeyType>("company");
  const [keyValue, setKeyValue] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getSuppressions();
      setSuppressions(result.suppressions);
      setError(null);
    } catch {
      setError("Unable to load your muted sources.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!keyValue.trim() || saving) {
      return;
    }

    setSaving(true);
    try {
      await api.createSuppression({
        keyType: keyType === "company" ? "company" : "fingerprint",
        keyValue: keyValue.trim(),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setKeyValue("");
      setReason("");
      setError(null);
      await load();
    } catch {
      setError("Unable to save that rule.");
    } finally {
      setSaving(false);
    }
  };

  const onRemove = async (id: string) => {
    try {
      await api.deleteSuppression(id);
      setSuppressions((current) => current.filter((entry) => entry.id !== id));
      setError(null);
    } catch {
      setError("Unable to remove that rule.");
    }
  };

  return (
    <section className="card stacked-form">
      <h2>Muted sources</h2>
      <p className="muted">
        Opportunities matching these rules are never proposed again. Closing an opportunity as
        rejected, withdrawn, or dismissed adds the posting here automatically, so agents do not
        re-propose it even if you later delete it.
      </p>

      <form className="stacked-form" onSubmit={onSubmit}>
        <label htmlFor="suppression-key-type">What to mute</label>
        <select
          id="suppression-key-type"
          value={keyType}
          onChange={(event) => setKeyType(event.target.value as SuppressionKeyType)}
        >
          <option value="company">An entire company</option>
          <option value="fingerprint">A specific role at a company</option>
        </select>

        <label htmlFor="suppression-key-value">
          {keyType === "company" ? "Company name" : "Company|title|location fingerprint"}
        </label>
        <input
          id="suppression-key-value"
          value={keyValue}
          onChange={(event) => setKeyValue(event.target.value)}
          placeholder={keyType === "company" ? "Acme, Inc." : "acme inc|ios engineer|stockholm"}
        />

        <label htmlFor="suppression-reason">Why (optional)</label>
        <input
          id="suppression-reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Not hiring at my level"
        />

        <p className="muted">
          {suppressionExpiresByDefault(keyType)
            ? "Lapses automatically after 180 days, so a decision you made once does not quietly narrow your search forever."
            : "Permanent until you remove it."}
        </p>

        <button type="submit" disabled={saving || !keyValue.trim()}>
          {saving ? "Saving..." : "Mute"}
        </button>
      </form>

      {error ? <p role="alert">{error}</p> : null}

      {loading ? (
        <p className="muted">Loading...</p>
      ) : suppressions.length === 0 ? (
        <p className="muted">Nothing is muted. Every opportunity an agent finds will be proposed.</p>
      ) : (
        <ul className="stacked-list">
          {suppressions.map((suppression) => (
            <li key={suppression.id} className="card">
              <strong>{suppressionKeyTypeLabels[suppression.key_type]}</strong>
              <p>{suppression.key_value}</p>
              {suppression.reason ? <p className="muted">{suppression.reason}</p> : null}
              <p className="muted">
                {suppressionSourceLabels[suppression.source]} &middot; {describeExpiry(suppression)}
              </p>
              <button
                type="button"
                onClick={() => void onRemove(suppression.id)}
                aria-label={`Stop muting ${suppression.key_value}`}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default SuppressionsTab;
