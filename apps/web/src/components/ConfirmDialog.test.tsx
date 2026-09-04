import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

afterEach(cleanup);

function renderDialog(overrides: Partial<Parameters<typeof ConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConfirmDialog
      title="Dismiss this?"
      confirmLabel="Dismiss"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...overrides}
    >
      <p>It stays on record.</p>
    </ConfirmDialog>,
  );
  return { onConfirm, onCancel };
}

describe("ConfirmDialog", () => {
  it("presents itself as a modal alert", () => {
    renderDialog();
    const dialog = screen.getByRole("alertdialog", { name: "Dismiss this?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("It stays on record.")).toBeVisible();
  });

  it("focuses Cancel rather than the destructive action", () => {
    renderDialog();
    // The dialog exists because something irreversible is about to happen, so
    // a stray Enter on arrival must not perform it.
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
  });

  it("confirms only when the confirming button is pressed", () => {
    const { onConfirm, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("cancels on Escape", () => {
    const { onCancel, onConfirm } = renderDialog();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("cancels when the backdrop is clicked but not the panel", () => {
    const { onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("alertdialog"));
    expect(onCancel).not.toHaveBeenCalled();

    fireEvent.click(document.querySelector(".confirm-dialog-backdrop")!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps Tab inside the dialog", () => {
    renderDialog();
    const cancel = screen.getByRole("button", { name: "Cancel" });
    const confirm = screen.getByRole("button", { name: "Dismiss" });

    confirm.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(cancel).toHaveFocus();

    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(confirm).toHaveFocus();
  });

  it("returns focus to whatever opened it", () => {
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    trigger.focus();

    const { unmount } = render(
      <ConfirmDialog title="t" confirmLabel="Go" onConfirm={vi.fn()} onCancel={vi.fn()}>
        <p>body</p>
      </ConfirmDialog>,
    );
    unmount();

    expect(trigger).toHaveFocus();
    trigger.remove();
  });

  it("disables the destructive action while it is running", () => {
    renderDialog({ busy: true });
    expect(screen.getByRole("button", { name: "Working..." })).toBeDisabled();
  });
});
