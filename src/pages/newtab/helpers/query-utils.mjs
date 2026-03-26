const CJK_TEXT_PATTERN = /[\u3400-\u9fff]/;
const ENGLISH_TERM_PATTERN = /\b[a-z][a-z0-9.+-]*\b/gi;
const DIRECT_URL_PATTERN = /^(localhost|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,})(?::\d{2,5})?(?:[/?#].*)?$/i;

export const normalizeTextValue = (value) => (typeof value === "string" ? value.trim() : "");

export const firstNonEmptyText = (...values) => {
  for (const value of values) {
    const text = normalizeTextValue(value);
    if (text) {
      return text;
    }
  }

  return "";
};

export const uniqueTextList = (values) => {
  const seen = new Set();
  const result = [];

  values.forEach((value) => {
    const text = normalizeTextValue(value);
    if (!text) {
      return;
    }

    const normalizedKey = text.toLowerCase();
    if (seen.has(normalizedKey)) {
      return;
    }

    seen.add(normalizedKey);
    result.push(text);
  });

  return result;
};

export const extractEnglishTerms = (value) => {
  if (typeof value !== "string") {
    return [];
  }

  return uniqueTextList((value.match(ENGLISH_TERM_PATTERN) ?? []).map((term) => term.toLowerCase()));
};

export const hasMixedLanguageTerms = (value) => CJK_TEXT_PATTERN.test(value) && extractEnglishTerms(value).length > 0;

export const normalizeMixedLanguageSpacing = (value) => normalizeTextValue(value)
  .replace(/([a-zA-Z0-9])(?=[\u3400-\u9fff])/g, "$1 ")
  .replace(/([\u3400-\u9fff])(?=[a-zA-Z0-9])/g, "$1 ")
  .replace(/\s+/g, " ")
  .trim();

export const resolveDirectNavigationTarget = (value) => {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate || /\s/.test(candidate)) {
    return "";
  }

  if (/^https?:\/\//i.test(candidate)) {
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        return parsed.href;
      }
    } catch {
      return "";
    }

    return "";
  }

  if (DIRECT_URL_PATTERN.test(candidate)) {
    return `https://${candidate}`;
  }

  return "";
};

export const resolveNavigationTarget = (value) => {
  if (typeof value !== "string" || !value.trim()) {
    return "";
  }

  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return parsed.href;
    }
  } catch {
    return "";
  }

  return "";
};
