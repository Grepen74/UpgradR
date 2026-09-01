import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConfirmButton, StatusMessage } from "./Feedback";

afterEach(cleanup);

describe("StatusMessage", () => {
  it("announces asynchronous feedback politely", () => {
    render(<StatusMessage>Saved</StatusMessage>);
    expect(screen.getByRole("status")).toHaveTextContent("Saved");
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});

describe("ConfirmButton", () => {
  it("requires two deliberate activations", () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmButton confirmLabel="Confirm delete" onConfirm={onConfirm}>
        Delete
      </ConfirmButton>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
