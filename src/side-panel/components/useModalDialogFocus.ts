import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface ModalDialogFocusOptions {
  dialogRef: RefObject<HTMLElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  onEscape?: () => void;
  open: boolean;
}

function getFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => element.getAttribute("aria-hidden") !== "true");
}

export function useModalDialogFocus({ dialogRef, initialFocusRef, onEscape, open }: ModalDialogFocusOptions) {
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!open) {
      return;
    }

    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    const initialFocus = initialFocusRef?.current ?? (dialog ? getFocusableElements(dialog)[0] : null) ?? dialog;
    initialFocus?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      const activeDialog = dialogRef.current;
      if (!activeDialog) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onEscapeRef.current?.();
        return;
      }
      if (event.key !== "Tab") {
        return;
      }
      const focusable = getFocusableElements(activeDialog);
      if (focusable.length === 0) {
        event.preventDefault();
        activeDialog.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey ? document.activeElement === first : document.activeElement === last) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const restoreFocus = restoreFocusRef.current;
      if (restoreFocus?.isConnected) {
        queueMicrotask(() => restoreFocus.focus({ preventScroll: true }));
      }
    };
  }, [dialogRef, initialFocusRef, open]);
}
