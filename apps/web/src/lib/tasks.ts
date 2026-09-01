import type { TaskSummary } from "../api";

/** A task is overdue when it has a due date in the past and is not yet completed. */
export function isTaskOverdue(task: Pick<TaskSummary, "due_at" | "is_completed">, now = new Date()): boolean {
  if (task.is_completed || !task.due_at) {
    return false;
  }
  return new Date(task.due_at).getTime() < now.getTime();
}
