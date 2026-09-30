import { useEffect, useState } from "react";
import type { ApplicationStatus } from "@upgradr/contracts";
import { stageForStatus } from "@upgradr/domain";

export type ClosingDateUrgency = { tone: "orange" | "red"; label: string };

export function useCalendarClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function scheduleNextDay() {
      const current = new Date();
      const nextDay = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
      timer = setTimeout(() => {
        setNow(new Date());
        scheduleNextDay();
      }, nextDay.getTime() - current.getTime());
    }
    function refreshOnReturn() {
      if (!document.hidden) {
        setNow(new Date());
        clearTimeout(timer);
        scheduleNextDay();
      }
    }
    scheduleNextDay();
    document.addEventListener("visibilitychange", refreshOnReturn);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", refreshOnReturn);
    };
  }, []);
  return now;
}

export function closingDateUrgency(
  closingDate: string | null,
  status: ApplicationStatus,
  now: Date = new Date(),
): ClosingDateUrgency | null {
  const stage = stageForStatus(status);
  if (!closingDate || (stage !== "inbox" && stage !== "shortlist")) {
    return null;
  }

  const [year, month, day] = closingDate.split("-").map(Number);
  const closingDay = new Date(0);
  closingDay.setUTCFullYear(year!, month! - 1, day!);
  const today = new Date(0);
  today.setUTCFullYear(now.getFullYear(), now.getMonth(), now.getDate());
  const remaining = Math.round((closingDay.getTime() - today.getTime()) / 86_400_000);
  if (remaining >= 7) {
    return null;
  }
  if (remaining < 0) {
    return { tone: "red", label: "Posting closed" };
  }
  if (remaining === 0) {
    return { tone: "red", label: "Closes today" };
  }
  return {
    tone: remaining === 1 ? "red" : "orange",
    label: `Only ${remaining} day${remaining === 1 ? "" : "s"} left to apply`,
  };
}

export function ClosingDateWarning({
  urgency,
  showLabel = false,
}: {
  urgency: ClosingDateUrgency;
  showLabel?: boolean;
}) {
  return (
    <span className={`closing-date-warning closing-date-warning-${urgency.tone}`} title={urgency.label}>
      <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5 3 2 6M19 3l3 3M6 22l2-2M18 22l-2-2" />
        <circle cx="12" cy="13" r="8" />
        <path d="M12 9v4l3 2" />
      </svg>
      {showLabel ? <span>{urgency.label}</span> : <span className="sr-only">{urgency.label}</span>}
    </span>
  );
}
