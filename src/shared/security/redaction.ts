const REDACTED_VALUE = "[已脱敏]";
const SENSITIVE_KEY = "(?:token|secret|password|passwd|pwd|authorization|auth|api[_-]?key|session|jwt|credential|cookie|set-cookie|bearer)";
const SENSITIVE_ASSIGNMENT_PATTERN = new RegExp(
  `\\b(${SENSITIVE_KEY})\\b(\\s*[=:]\\s*)(?:Bearer\\s+)?("(?:\\\\.|[^"])*"|'(?:\\\\.|[^'])*'|[^\\s,;&}]+)`,
  "gi",
);
const SENSITIVE_JSON_STRING_PATTERN = new RegExp(
  `("(?:${SENSITIVE_KEY})"\\s*:\\s*)"(?:\\\\.|[^"])*"`,
  "gi",
);
const SENSITIVE_BEARER_PATTERN = /\bBearer\s+("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s,;&}]+)/gi;
const SENSITIVE_QUERY_PATTERN = new RegExp(`([?&]${SENSITIVE_KEY}(?:\\[[^\\]]*\\])?=)[^&#\\s]*`, "gi");

/**
 * Redacts credential-shaped values before content leaves a chat session.
 * Runtime tools may return raw values in a fully authorized session, but
 * clipboard and export paths must not persist those values by default.
 */
export function redactSensitiveText(value: string): string {
  return value
    .replace(SENSITIVE_BEARER_PATTERN, `Bearer ${REDACTED_VALUE}`)
    .replace(SENSITIVE_QUERY_PATTERN, `$1${REDACTED_VALUE}`)
    .replace(SENSITIVE_JSON_STRING_PATTERN, `$1"${REDACTED_VALUE}"`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, `$1$2${REDACTED_VALUE}`);
}
