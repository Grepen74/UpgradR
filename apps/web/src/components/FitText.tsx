import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Smallest scale text is shrunk to before it is truncated with an ellipsis instead. */
export const MIN_FIT_SCALE = 0.7;

/**
 * Scale that makes content `needed` px wide fit `available` px, clamped to
 * `[min, 1]`. The width of wrapping text is set by its longest unbreakable
 * word, and font size scales that linearly, so a single ratio is enough.
 */
export function fitScale(available: number, needed: number, min = MIN_FIT_SCALE): number {
  if (available <= 0 || needed <= available) {
    return 1;
  }
  return Math.max(min, Math.floor((available / needed) * 100) / 100);
}

/**
 * Text that shrinks to fit its box when an unbreakable word would overflow
 * it, and falls back to an ellipsis below `MIN_FIT_SCALE`.
 *
 * Exposes the scale as `--fit-scale` for the consumer's own `font-size` rule
 * to multiply, and `data-fit="truncated"` for the ellipsis styling, so it
 * works with whatever font size the surrounding component already sets.
 * Wrapping titles that already fit are left untouched.
 */
export function FitText({ text, className }: { text: string; className?: string }): ReactNode {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }

    const measure = () => {
      // Measure at natural size, otherwise a previous shrink hides the overflow.
      element.style.setProperty("--fit-scale", "1");
      const available = element.clientWidth;
      const needed = element.scrollWidth;
      const scale = fitScale(available, needed);
      const truncated = available > 0 && needed * MIN_FIT_SCALE > available;

      element.style.setProperty("--fit-scale", String(scale));
      if (truncated) {
        element.dataset.fit = "truncated";
        element.title = text;
      } else {
        delete element.dataset.fit;
        element.removeAttribute("title");
      }
    };

    measure();
    // Web fonts can arrive after first layout and change every width.
    void document.fonts?.ready.then(measure);
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text]);

  return (
    <strong ref={ref} className={className ? `fit-text ${className}` : "fit-text"}>
      {text}
    </strong>
  );
}
