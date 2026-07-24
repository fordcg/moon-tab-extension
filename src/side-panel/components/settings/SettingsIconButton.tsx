import type { ButtonHTMLAttributes } from "react";

export type SettingsActionIconName =
  | "arrow-down"
  | "arrow-up"
  | "check"
  | "check-circle"
  | "chevron-down"
  | "chevron-up"
  | "download"
  | "eraser"
  | "eye"
  | "eye-off"
  | "key-x"
  | "loader"
  | "plus"
  | "refresh"
  | "rotate-ccw"
  | "save"
  | "settings"
  | "sparkles"
  | "trash"
  | "upload"
  | "x"
  | "x-circle"
  | "zap";

interface SettingsIconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children" | "type"> {
  icon: SettingsActionIconName;
  label: string;
  tooltip?: string;
  variant?: "primary" | "secondary";
}

export function SettingsIconButton({
  icon,
  label,
  tooltip,
  variant = "secondary",
  className,
  disabled,
  ...buttonProps
}: SettingsIconButtonProps) {
  return (
    <button
      {...buttonProps}
      className={[
        variant === "primary" ? "ui-button-primary" : "ui-button-secondary",
        "settings-icon-button",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      type="button"
      aria-label={label}
      data-soft-tooltip={tooltip ?? label}
      disabled={disabled}
    >
      <SettingsActionIcon name={icon} />
    </button>
  );
}

interface SettingsActionIconDefinition {
  paths: string[];
  circles?: Array<{ cx: number; cy: number; r: number }>;
}

const SETTINGS_ACTION_ICONS: Record<SettingsActionIconName, SettingsActionIconDefinition> = {
  "arrow-down": {
    paths: ["M12 5v14", "M19 12l-7 7-7-7"],
  },
  "arrow-up": {
    paths: ["M12 19V5", "M5 12l7-7 7 7"],
  },
  check: {
    paths: ["M20 6 9 17l-5-5"],
  },
  "check-circle": {
    circles: [{ cx: 12, cy: 12, r: 9 }],
    paths: ["M8.5 12.5 11 15l4.5-5"],
  },
  "chevron-down": {
    paths: ["M6 9l6 6 6-6"],
  },
  "chevron-up": {
    paths: ["M18 15l-6-6-6 6"],
  },
  download: {
    paths: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  },
  eraser: {
    paths: [
      "M21 21H8a2 2 0 0 1-1.42-.59l-4.99-4.99a2 2 0 0 1 0-2.83l8.99-8.99a2 2 0 0 1 2.83 0l7 7a2 2 0 0 1 0 2.83L12.83 21",
      "M5 11l8 8",
    ],
  },
  eye: {
    circles: [{ cx: 12, cy: 12, r: 2.75 }],
    paths: ["M2.75 12s3.25-5.5 9.25-5.5 9.25 5.5 9.25 5.5-3.25 5.5-9.25 5.5S2.75 12 2.75 12Z"],
  },
  "eye-off": {
    paths: [
      "M2.75 12s3.25-5.5 9.25-5.5c1.08 0 2.07.18 2.96.47",
      "M21.25 12s-3.25 5.5-9.25 5.5c-1.08 0-2.07-.18-2.96-.47",
      "M4.5 4.5 19.5 19.5",
      "M9.9 9.9a3 3 0 0 0 4.2 4.2",
    ],
  },
  "key-x": {
    paths: [
      "M2 18v3h3l8.6-8.6",
      "M15 7a4 4 0 1 0-4 4",
      "M18 14l4 4",
      "M22 14l-4 4",
    ],
  },
  loader: {
    paths: ["M21 12a9 9 0 1 1-6.22-8.56"],
  },
  plus: {
    paths: ["M5 12h14", "M12 5v14"],
  },
  refresh: {
    paths: ["M21 12a9 9 0 0 0-15.74-5.94L3 8", "M3 3v5h5", "M3 12a9 9 0 0 0 15.74 5.94L21 16", "M16 16h5v5"],
  },
  "rotate-ccw": {
    paths: ["M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8", "M3 3v5h5"],
  },
  save: {
    paths: [
      "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z",
      "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",
      "M7 3v4a1 1 0 0 0 1 1h7",
    ],
  },
  settings: {
    paths: ["M4 21v-7", "M4 10V3", "M12 21v-9", "M12 8V3", "M20 21v-5", "M20 12V3", "M2 14h4", "M10 8h4", "M18 16h4"],
  },
  sparkles: {
    paths: [
      "M12 3l1.85 5.15L19 10l-5.15 1.85L12 17l-1.85-5.15L5 10l5.15-1.85L12 3Z",
      "M19 3v4",
      "M21 5h-4",
      "M4 17v3",
      "M5.5 18.5h-3",
    ],
  },
  trash: {
    paths: ["M3 6h18", "M8 6V4h8v2", "M19 6l-1 14H6L5 6", "M10 11v6", "M14 11v6"],
  },
  upload: {
    paths: ["M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"],
  },
  x: {
    paths: ["M18 6 6 18", "M6 6l12 12"],
  },
  "x-circle": {
    circles: [{ cx: 12, cy: 12, r: 9 }],
    paths: ["M15 9l-6 6", "M9 9l6 6"],
  },
  zap: {
    paths: ["M13 2 3 14h8l-1 8 10-12h-8l1-8Z"],
  },
};

export function SettingsActionIcon({ name }: { name: SettingsActionIconName }) {
  const icon = SETTINGS_ACTION_ICONS[name];

  return (
    <span className={name === "loader" ? "settings-action-icon settings-action-icon-loading" : "settings-action-icon"} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        {icon.paths.map((path) => (
          <path key={path} d={path} />
        ))}
        {icon.circles?.map((circle) => (
          <circle key={`${circle.cx}-${circle.cy}-${circle.r}`} cx={circle.cx} cy={circle.cy} r={circle.r} />
        ))}
      </svg>
    </span>
  );
}
