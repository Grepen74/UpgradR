import { useCallback, useEffect, useState } from "react";

// Deep link for the opportunity detail view, e.g. /applications/<uuid>.
// There is no router dependency in this project (see App.tsx's
// isConsentRoute, which already reads window.location directly), and
// apps/web/wrangler.jsonc's SPA fallback (not_found_handling:
// "single-page-application") ensures a direct navigation to this path
// still serves index.html in production.
const APPLICATION_DETAIL_PATTERN = /^\/applications\/([^/]+)\/?$/;

export function applicationDetailPath(applicationId: string): string {
  return `/applications/${encodeURIComponent(applicationId)}`;
}

function matchApplicationId(pathname: string): string | null {
  const match = APPLICATION_DETAIL_PATTERN.exec(pathname);
  const id = match?.[1];
  return id ? decodeURIComponent(id) : null;
}

/** True when the current URL deep-links directly into the opportunity detail view. */
export function isApplicationDetailRoute(pathname = window.location.pathname): boolean {
  return matchApplicationId(pathname) !== null;
}

export function isApplicationsRoute(pathname = window.location.pathname): boolean {
  return pathname === "/applications" || isApplicationDetailRoute(pathname);
}

/**
 * Tracks the deep-linked opportunity id from the URL and keeps it in sync
 * with browser history, so the detail panel/full-screen view can be opened,
 * closed, shared, and navigated with back/forward.
 */
export function useOpportunityRoute(): {
  selectedApplicationId: string | null;
  openApplication: (applicationId: string) => void;
  closeApplication: () => void;
} {
  const [selectedApplicationId, setSelectedApplicationId] = useState<string | null>(() =>
    matchApplicationId(window.location.pathname),
  );

  useEffect(() => {
    function onPopState() {
      setSelectedApplicationId(matchApplicationId(window.location.pathname));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const openApplication = useCallback((applicationId: string) => {
    setSelectedApplicationId(applicationId);
    window.history.pushState({}, "", applicationDetailPath(applicationId));
  }, []);

  const closeApplication = useCallback(() => {
    setSelectedApplicationId(null);
    window.history.pushState({}, "", "/applications");
  }, []);

  return { selectedApplicationId, openApplication, closeApplication };
}
