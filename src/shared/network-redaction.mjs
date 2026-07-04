const DEFAULT_MAX_TEXT_LENGTH = 12000;
export const REDACTED_VALUE = "[已脱敏]";

const SENSITIVE_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-csrf-token",
  "x-xsrf-token",
  "api-key",
  "apikey",
  "access-token",
  "refresh-token",
]);

const SENSITIVE_COMPACT_NAMES = new Set([
  "apikey",
  "authtoken",
  "authorization",
  "clientsecret",
  "credential",
  "credentials",
  "password",
  "passwd",
  "pwd",
  "sessionid",
  "secretkey",
  "token",
  "accesstoken",
  "refreshtoken",
]);
const SENSITIVE_TOKEN_NAMES = new Set([
  "authorization",
  "auth",
  "credential",
  "credentials",
  "jwt",
  "password",
  "passwd",
  "pwd",
  "secret",
  "session",
  "token",
]);
const SENSITIVE_KEY_PATTERN = /(^|[-_])(token|secret|password|passwd|pwd|authorization|auth|api[-_]?key|session|jwt|credential|client[-_]?secret|refresh[-_]?token|access[-_]?token)([-_]|$)/i;
const BEARER_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const ASSIGNMENT_PATTERN = /\b([A-Za-z][A-Za-z0-9_-]*)(\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s&,;}]+)/g;

const normalizeText = (value) => (typeof value === "string" ? value : "");

export function truncateText(value, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, maxLength), truncated: true };
}

export function isSensitiveName(name) {
  const rawName = normalizeText(name).trim();
  const normalized = rawName.toLowerCase();
  if (SENSITIVE_HEADER_NAMES.has(normalized) || SENSITIVE_COMPACT_NAMES.has(normalized)) return true;
  if (SENSITIVE_KEY_PATTERN.test(normalized)) return true;
  const tokens = splitNameTokens(rawName);
  return tokens.some((token) => SENSITIVE_TOKEN_NAMES.has(token)) || hasSensitiveTokenPair(tokens);
}

export function redactUrl(rawUrl, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  const original = normalizeText(rawUrl);
  let redacted = false;
  let nextUrl = original;

  try {
    const parsed = new URL(original);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (isSensitiveName(key)) {
        parsed.searchParams.set(key, REDACTED_VALUE);
        redacted = true;
      }
    }
    nextUrl = parsed.toString();
  } catch {
    nextUrl = original.replace(ASSIGNMENT_PATTERN, (match, key, separator) =>
      isSensitiveName(key) ? `${key}${separator}${REDACTED_VALUE}` : match
    );
    redacted = nextUrl !== original;
  }

  const truncated = truncateText(nextUrl, maxLength);
  return { ...truncated, redacted };
}

export function redactHeaders(headers, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  if (!Array.isArray(headers)) {
    return { headers: undefined, redacted: false };
  }

  let redacted = false;
  const safeHeaders = headers
    .filter((header) => header && typeof header.name === "string" && typeof header.value === "string")
    .map((header) => {
      if (isSensitiveName(header.name)) {
        redacted = true;
        return { name: header.name, value: REDACTED_VALUE };
      }

      const value = header.value.replace(BEARER_PATTERN, (_match, scheme) => {
        redacted = true;
        return `${scheme} ${REDACTED_VALUE}`;
      });
      return { name: header.name, value: truncateText(value, maxLength).text };
    });

  return { headers: safeHeaders.length ? safeHeaders : undefined, redacted };
}

function redactJsonValue(value) {
  if (Array.isArray(value)) {
    let redacted = false;
    const next = value.map((item) => {
      const result = redactJsonValue(item);
      redacted ||= result.redacted;
      return result.value;
    });
    return { value: next, redacted };
  }

  if (!value || typeof value !== "object") {
    return { value, redacted: false };
  }

  let redacted = false;
  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (isSensitiveName(key)) {
      next[key] = REDACTED_VALUE;
      redacted = true;
      continue;
    }
    const result = redactJsonValue(child);
    next[key] = result.value;
    redacted ||= result.redacted;
  }
  return { value: next, redacted };
}

export function redactBodyText(bodyText, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  const original = normalizeText(bodyText);
  if (!original) {
    return { text: undefined, redacted: false, truncated: false };
  }

  let redacted = false;
  let text = original;
  const trimmed = original.trim();

  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      const parsed = JSON.parse(trimmed);
      const result = redactJsonValue(parsed);
      text = JSON.stringify(result.value, null, 2);
      redacted = result.redacted;
    } catch {
      // Fall through to text-pattern redaction.
    }
  }

  const bearerRedacted = text.replace(BEARER_PATTERN, (_match, scheme) => {
    redacted = true;
    return `${scheme} ${REDACTED_VALUE}`;
  });
  const assignmentRedacted = bearerRedacted.replace(ASSIGNMENT_PATTERN, (match, key, separator) => {
    if (!isSensitiveName(key)) return match;
    redacted = true;
    return `${key}${separator}${REDACTED_VALUE}`;
  });

  const truncated = truncateText(assignmentRedacted, maxLength);
  return { ...truncated, redacted };
}

function splitNameTokens(name) {
  return normalizeText(name)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function hasSensitiveTokenPair(tokens) {
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index] === "api" && tokens[index + 1] === "key") return true;
  }
  return false;
}

export function redactNetworkRecord(record, maxLength = DEFAULT_MAX_TEXT_LENGTH) {
  const url = redactUrl(record?.url ?? "", maxLength);
  const requestHeaders = redactHeaders(record?.requestHeaders, maxLength);
  const responseHeaders = redactHeaders(record?.responseHeaders, maxLength);
  const requestBody = redactBodyText(record?.requestBody, maxLength);
  const responseBody = redactBodyText(record?.responseBody, maxLength);

  return {
    ...record,
    url: url.text,
    requestHeaders: requestHeaders.headers,
    responseHeaders: responseHeaders.headers,
    requestBody: requestBody.text,
    responseBody: responseBody.text,
    truncated: Boolean(record?.truncated || url.truncated || requestBody.truncated || responseBody.truncated),
    redacted: Boolean(
      record?.redacted ||
        url.redacted ||
        requestHeaders.redacted ||
        responseHeaders.redacted ||
        requestBody.redacted ||
        responseBody.redacted
    ),
  };
}
