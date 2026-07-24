import { redactSensitiveText } from "../../shared/security/redaction";

export const PAGE_STATE_MAX_TEXT_LENGTH = 120;
export const ELEMENT_INSPECTION_MAX_TEXT_LENGTH = 500;

const SENSITIVE_PAGE_STATE_NAME_PATTERN =
  /(authorization|cookie|token|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|passwd|credential|session|sid|code|csrf|xsrf)/i;

export function isSensitivePageStateName(value: string): boolean {
  return SENSITIVE_PAGE_STATE_NAME_PATTERN.test(value);
}

export function truncatePageStateText(value: string, maxLength = PAGE_STATE_MAX_TEXT_LENGTH): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

export function redactPageStateText(value: string): string {
  return redactSensitiveText(value);
}

export function redactPageStateUrl(value: string): string {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(value);
    for (const key of Array.from(url.searchParams.keys())) {
      if (isSensitivePageStateName(key)) {
        url.searchParams.set(key, "[已脱敏]");
      }
    }
    return truncatePageStateText(url.toString().replace(/%5B%E5%B7%B2%E8%84%B1%E6%95%8F%5D/g, "[已脱敏]"), 500);
  } catch {
    return truncatePageStateText(redactPageStateText(value), 500);
  }
}
