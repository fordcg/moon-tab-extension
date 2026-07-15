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

interface MenuPosition {
  left: number;
  maxHeight: number;
  top: number;
  width: number;
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
  const [menuPosition, setMenuPosition] = useState<MenuPosition | undefined>();
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

    const viewportPad = 12;
    const gap = 6;
    const width = Math.max(180, Math.min(rect.width || 240, window.innerWidth - viewportPad * 2));
    const left = Math.max(viewportPad, Math.min(rect.left, window.innerWidth - width - viewportPad));
    const preferredMax = Math.min(window.innerHeight * 0.46, 20 * 16);
    const spaceBelow = window.innerHeight - rect.bottom - gap - viewportPad;
    const spaceAbove = rect.top - gap - viewportPad;
    const openAbove = spaceBelow < 10 * 16 && spaceAbove > spaceBelow;
    const available = Math.max(7.5 * 16, openAbove ? spaceAbove : spaceBelow);
    const maxHeight = Math.min(preferredMax, available);
    const top = openAbove
      ? Math.max(viewportPad, rect.top - gap - maxHeight)
      : Math.min(rect.bottom + gap, window.innerHeight - viewportPad - Math.min(maxHeight, available));

    setMenuPosition({ left, top, width, maxHeight });
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
            style={
              menuPosition
                ? {
                    left: menuPosition.left,
                    top: menuPosition.top,
                    width: menuPosition.width,
                    maxHeight: menuPosition.maxHeight,
                    right: "auto",
                    bottom: "auto",
                  }
                : undefined
            }
          >
            {/* Match composer ModelSelector: scroll lives on option-list because
                the shared menu shell uses overflow:hidden for the outer chrome. */}
            <div className="model-select-option-list">
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
