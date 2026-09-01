// Pure selection-state helpers for the profile import review UI (see
// ../ProfileImportReview.tsx). Kept free of React/DOM so the toggling and
// payload-building logic is trivially unit testable independent of the
// component that renders it.

export interface ProfileImportSelection {
  confirmProfile: boolean;
  experienceIndexes: ReadonlySet<number>;
  educationIndexes: ReadonlySet<number>;
  skillIndexes: ReadonlySet<number>;
}

export function emptySelection(): ProfileImportSelection {
  return {
    confirmProfile: false,
    experienceIndexes: new Set(),
    educationIndexes: new Set(),
    skillIndexes: new Set(),
  };
}

/** Returns a new set with `index` toggled in/out -- never mutates `indexes`. */
export function toggleIndex(indexes: ReadonlySet<number>, index: number): Set<number> {
  const next = new Set(indexes);
  if (next.has(index)) {
    next.delete(index);
  } else {
    next.add(index);
  }
  return next;
}

/** Whether at least one item is selected across the whole selection. */
export function hasSelection(selection: ProfileImportSelection): boolean {
  return (
    selection.confirmProfile ||
    selection.experienceIndexes.size > 0 ||
    selection.educationIndexes.size > 0 ||
    selection.skillIndexes.size > 0
  );
}

/**
 * Builds the POST /api/profile/imports/:id/confirm request body from the
 * current selection: sorted, deduplicated (a Set already guarantees
 * dedup) index arrays plus the profile flag.
 */
export function buildConfirmInput(selection: ProfileImportSelection): {
  confirmProfile: boolean;
  experienceIndexes: number[];
  educationIndexes: number[];
  skillIndexes: number[];
} {
  return {
    confirmProfile: selection.confirmProfile,
    experienceIndexes: [...selection.experienceIndexes].sort((a, b) => a - b),
    educationIndexes: [...selection.educationIndexes].sort((a, b) => a - b),
    skillIndexes: [...selection.skillIndexes].sort((a, b) => a - b),
  };
}
