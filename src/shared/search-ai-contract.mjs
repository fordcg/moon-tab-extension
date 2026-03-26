const AI_REFUSAL_PATTERN = /i'm grok|i am grok|not a search router|won't follow|cannot comply|can't comply|as an ai|conflicting system instructions|不能遵循|无法遵循|不是搜索路由器/i;
const SEARCH_QUERY_TEXT_MAX_LENGTH = 120;
const HTML_RESPONSE_PATTERN = /<!doctype html|<html[\s>]|<head[\s>]|<body[\s>]|<title[\s>]|<meta[\s>]|<script[\s>]/i;

const parseJsonSafely = (value) => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const looksLikeHtmlDocument = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed || !trimmed.startsWith("<")) {
    return false;
  }

  return HTML_RESPONSE_PATTERN.test(trimmed);
};

const looksLikeGatewayErrorPage = (value) => /bad gateway|gateway timeout|error code: 1010|cloudflare|nginx/i.test(value);

const unwrapJsonFence = (value) => {
  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
};

const isLikelySearchQueryText = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return false;
  }

  if (trimmed.length > SEARCH_QUERY_TEXT_MAX_LENGTH) {
    return false;
  }

  if (/\r|\n/.test(trimmed)) {
    return false;
  }

  if (/[。！？!?]/.test(trimmed)) {
    return false;
  }

  const punctuationMatches = trimmed.match(/[,:;，：；]/g);
  if (punctuationMatches && punctuationMatches.length > 2) {
    return false;
  }

  return true;
};

const buildDecisionUserPrompt = (query) => [
  "你是浏览器搜索框的 AI 增强器。",
  "只输出一个 JSON 对象，不要输出解释、markdown 或多余文本。",
  "如果输入明显应该直接打开链接，输出 {\"mode\":\"open\",\"url\":\"完整 https URL\",\"summary\":\"一句话说明为什么直接打开\",\"intent\":\"简短意图标签\"}。",
  "其他情况输出 {\"mode\":\"search\",\"query\":\"优化后的主搜索词\",\"summary\":\"一句话说明用户想找什么、为什么这样搜\",\"intent\":\"简短意图标签\",\"suggestions\":[\"相关搜索1\",\"相关搜索2\",\"相关搜索3\"],\"websites\":[{\"title\":\"网站标题\",\"url\":\"https://example.com\",\"description\":\"为什么值得打开\"}]}。",
  "对于泛查询、模糊查询、图片查询、教程查询、灵感查询，不要原样回显输入；把 query 改写成更具体、更适合网页搜索的表达。",
  "如果用户输入是中英混合查询，优先保留原始英文词面，不要把英文关键词擅自翻译成中文同义词。",
  "像 skill、agent、plugin、workflow、mcp、prompt、api 这类英文术语，默认应该原样保留在 query 里；只能补充上下文，不能把它们改写丢失。",
  "只有当用户自己已经明确用中文表达同一个概念时，才允许用中文替换对应英文词。",
  "即使 query 与原词接近，也必须给出非空 summary 和至少 3 个更具体的 suggestions。",
  "如果你能确定和当前搜索最相关的网站，可以附带 2 到 4 个 websites；如果不能确定，可以省略 websites。",
  "suggestions 必须是可直接拿去搜索的短语，不要写完整句子。",
  "示例1 输入: github.com 输出: {\"mode\":\"open\",\"url\":\"https://github.com\",\"summary\":\"这是一个明确的网站目标，直接打开最快。\",\"intent\":\"直达网站\"}",
  "示例2 输入: moon tab 输出: {\"mode\":\"search\",\"query\":\"moon tab browser new tab extension\",\"summary\":\"用户大概率在找 Moon Tab 相关扩展或产品信息，所以把关键词补全成更明确的网页搜索表达。\",\"intent\":\"产品查找\",\"suggestions\":[\"moon tab chrome extension\",\"moon tab edge new tab\",\"moon tab github\"],\"websites\":[{\"title\":\"GitHub - Moon Tab\",\"url\":\"https://github.com/example/moon-tab\",\"description\":\"如果你想看源码或项目主页，可以先打开这个站点。\"}]}",
  "示例3 输入: 猫猫图片 输出: {\"mode\":\"search\",\"query\":\"可爱猫咪高清图片\",\"summary\":\"用户想快速看到更高质量的猫咪图片，所以把主搜索词改成更适合图片搜索的表达。\",\"intent\":\"图片搜索\",\"suggestions\":[\"布偶猫高清图片\",\"治愈系猫咪壁纸\",\"小奶猫可爱照片\"]}",
  "示例4 输入: ai的skill网站 输出: {\"mode\":\"search\",\"query\":\"AI skill 网站 推荐\",\"summary\":\"这是一个中英混合查询，保留 skill 原词比直接翻成 技能 更能贴近用户真实意图。\",\"intent\":\"术语保留搜索\",\"suggestions\":[\"AI skill tools 网站\",\"AI skill marketplace\",\"AI skill examples\"]}",
  `现在输入: ${query}`,
].join("\n");

export {
  AI_REFUSAL_PATTERN,
  buildDecisionUserPrompt,
  isLikelySearchQueryText,
  looksLikeGatewayErrorPage,
  looksLikeHtmlDocument,
  parseJsonSafely,
  unwrapJsonFence,
};
