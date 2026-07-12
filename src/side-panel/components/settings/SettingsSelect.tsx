import { useEffect, useId, useRef, useState } from "react";

export interface SettingsSelectOption<T extends string> {
  label: string;
  value: T;
}

interface SettingsSelectProps<T extends string> {
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  options: Array<SettingsSelectOption<T>>;
  triggerAriaLabel?: string | null;
  value: T;
  onChange: (value: T) => void;
}

export function SettingsSelect<T extends string>({
  ariaLabel,
  className = "",
  disabled = false,
  options,
  triggerAriaLabel,
  value,
  onChange,
}: SettingsSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number } | undefined>();
  const wrapperRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listboxId = useId();
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  const resolvedTriggerAriaLabel = triggerAriaLabel === undefined ? ariaLabel : triggerAriaLabel;

  const updateMenuPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const width = Math.max(180, Math.min(rect.width || 240, window.innerWidth - 24));
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(rect.bottom + 6, window.innerHeight - 12));
    setMenuPosition({ left, top, width });
  };

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    updateMenuPosition();
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && wrapperRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
      }
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape, true);
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  return (
    <>
      <span
        ref={wrapperRef}
        className={["model-select-label sidepanel-settings-select sidepanel-channel-select", open ? "is-model-menu-open" : "", className]
          .filter(Boolean)
          .join(" ")}
      >
        <button
          ref={triggerRef}
          className="model-select-trigger"
          type="button"
          aria-label={resolvedTriggerAriaLabel ?? undefined}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          disabled={disabled}
          onClick={() => {
            updateMenuPosition();
            setOpen((value) => !value);
          }}
        >
          <span className="model-select-value" aria-hidden="true">{selectedOption?.label ?? ""}</span>
          <span className="model-select-chevron" aria-hidden="true" />
        </button>
        {open ? (
          <div
            className="model-select-menu"
            id={listboxId}
            role="listbox"
            aria-label={ariaLabel}
            style={menuPosition ? { left: menuPosition.left, top: menuPosition.top, width: menuPosition.width, right: "auto", bottom: "auto" } : undefined}
          >
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  className={selected ? "model-select-option model-select-option-active" : "model-select-option"}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                    triggerRef.current?.focus({ preventScroll: true });
                  }}
                >
                  <span className="model-select-option-label">{option.label}</span>
                  {selected ? <span className="model-select-option-check" aria-hidden="true">✓</span> : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </span>
      <select
        className={["ui-input chat-preference-shortcut-select", className].filter(Boolean).join(" ")}
        aria-label={ariaLabel}
        tabIndex={-1}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as T)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </>
  );
}
