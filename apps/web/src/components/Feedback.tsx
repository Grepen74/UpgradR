import { useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export function StatusMessage({ children }: { children: ReactNode }) {
  return (
    <p className="form-message" role="status" aria-live="polite">
      {children}
    </p>
  );
}

export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  ...buttonProps
}: {
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => void | Promise<void>;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onClick">) {
  const [armed, setArmed] = useState(false);

  async function activate() {
    if (!armed) {
      setArmed(true);
      return;
    }

    try {
      await onConfirm();
    } finally {
      setArmed(false);
    }
  }

  return (
    <button
      {...buttonProps}
      type="button"
      aria-label={armed ? confirmLabel : buttonProps["aria-label"]}
      onClick={() => void activate()}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}
