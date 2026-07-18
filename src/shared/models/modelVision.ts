/**
 * Heuristic vision capability detector for OpenAI-compatible / Anthropic model IDs.
 * Used when adding models so users don't have to manually toggle "支持视觉理解".
 *
 * Conservative: only mark true for well-known multimodal families.
 * Unknown IDs default to false (text-only safe default).
 */
export function detectModelSupportsVision(modelId: string | undefined | null, displayName?: string | undefined | null): boolean {
  const raw = [modelId, displayName].filter(Boolean).join(" ").toLowerCase().trim();
  if (!raw) {
    return false;
  }

  // Gateways often prefix with provider: "openai/gpt-4o", "anthropic/claude-sonnet-4"
  const text = raw
    .replaceAll(/[\\/]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();

  // Explicit negative markers first.
  if (
    /\b(text[-_]?only|no[-_]?vision|without[-_]?vision)\b/.test(text) ||
    /\b(tts|whisper|embed|embedding|moderation|transcribe|realtime-preview-audio)\b/.test(text)
  ) {
    return false;
  }

  // OpenAI / GPT multimodal families (including gpt-5 / gpt-5.5 / gpt-5-mini)
  if (
    /\bgpt-4o\b/.test(text) ||
    /\bgpt-4\.1\b/.test(text) ||
    /\bgpt-4-turbo\b/.test(text) ||
    /\bgpt-4-vision\b/.test(text) ||
    /\bchatgpt-4o\b/.test(text) ||
    /\bcomputer-use\b/.test(text) ||
    /\bgpt-5(\.\d+)?\b/.test(text) ||
    /\bgpt-5[-_]/.test(text)
  ) {
    return true;
  }

  // o-series that commonly accept image inputs on gateways
  if (/\b(o3|o4-mini|o1-pro)\b/.test(text) && !/\b(audio|tts|transcribe)\b/.test(text)) {
    return true;
  }

  // Anthropic Claude 3+/4 with vision
  if (/\bclaude\b/.test(text)) {
    if (/\bclaude[-_ ]?2\b|\bclaude[-_ ]?instant\b/.test(text)) {
      return false;
    }
    // Claude 3+ / sonnet / opus / haiku generally multimodal on modern APIs
    if (/\b(3|3\.5|3\.7|4|4\.5|sonnet|opus|haiku)\b/.test(text)) {
      return true;
    }
  }

  // Google Gemini multimodal
  if (/\bgemini\b/.test(text)) {
    if (/\b(embed|embedding|tts)\b/.test(text)) {
      return false;
    }
    return true;
  }

  // Qwen VL / Omni
  if (/\bqwen\b/.test(text) && /\b(vl|vision|omni)\b/.test(text)) {
    return true;
  }
  if (/\bqwen2(\.5)?-vl\b|\bqwen-vl\b|\bqwen3-vl\b/.test(text)) {
    return true;
  }

  // DeepSeek — only VL-named variants; v4-flash/chat/reasoner stay false
  if (/\bdeepseek\b/.test(text)) {
    return /\b(vl|vision)\b/.test(text);
  }

  // Moonshot / Kimi
  if (/\b(moonshot|kimi)\b/.test(text)) {
    return /\b(vl|vision|kimi-latest|k1|k2)\b/.test(text) || /\bkimi[-_.]?(latest|k1|k2)\b/.test(text);
  }

  // GLM / Zhipu
  if (/\bglm[-_ ]?(4v|4\.1v|4\.5v|4v-plus)\b/.test(text) || /\bglm-4v\b/.test(text)) {
    return true;
  }
  if (/\b(cogvlm|visualglm)\b/.test(text)) {
    return true;
  }

  // LLaVA / general open VL markers
  if (/\b(llava|moondream|phi-3-vision|phi-4-multimodal|idefics|pixtral|minicpm-v|internvl)\b/.test(text)) {
    return true;
  }

  // Grok vision-capable recent models
  if (/\bgrok\b/.test(text)) {
    return /\b(vision|2-vision)\b/.test(text) || /\bgrok-2\b/.test(text) || /\bgrok-4(\.|$|[-_])/.test(text);
  }

  // Stepfun / Yi VL
  if (/\b(step-1v|yi-vl|yi-vision)\b/.test(text)) {
    return true;
  }

  // Generic markers last
  if (/\b(vision|multimodal|omni)\b/.test(text) || /[-_]vl\b|\bvl[-_]/.test(text)) {
    return true;
  }

  return false;
}
