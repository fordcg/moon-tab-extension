/**
 * Heuristic vision capability detector for OpenAI-compatible / Anthropic model IDs.
 * Used when adding models so users don't have to manually toggle "支持视觉理解".
 *
 * Conservative: only mark true for well-known multimodal families.
 * Unknown IDs default to false (text-only safe default).
 */
export function detectModelSupportsVision(modelId: string | undefined | null, displayName?: string | undefined | null): boolean {
  const text = [modelId, displayName].filter(Boolean).join(" ").toLowerCase().trim();
  if (!text) {
    return false;
  }

  // Explicit negative markers first.
  if (
    /\b(text[-_]?only|no[-_]?vision|without[-_]?vision)\b/.test(text) ||
    /\b(tts|whisper|embed|embedding|moderation|transcribe|realtime-preview-audio)\b/.test(text)
  ) {
    return false;
  }

  // OpenAI / GPT multimodal families
  if (
    /\b(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|computer-use)\b/.test(text) ||
    /\bchatgpt-4o\b/.test(text) ||
    /\bgpt-4o[-_]?mini\b/.test(text) ||
    /\bgpt-4\.1[-_]?(mini|nano)?\b/.test(text) ||
    // gpt-5, gpt-5.1, gpt-5.2, gpt-5.4, gpt-5.5, gpt-5-mini, gpt-5-nano, ...
    /\bgpt-5(\.\d+)?([-_]|$)/.test(text)
  ) {
    return true;
  }
  // o-series: only mark models that commonly accept image inputs on gateways
  if (/\b(o3|o4-mini|o1-pro)\b/.test(text) && !/\b(audio|tts|transcribe)\b/.test(text)) {
    return true;
  }

  // Anthropic Claude 3+/4 with vision
  if (/\bclaude[-_ ]?(3|3\.5|3\.7|4|4\.5|sonnet|opus|haiku)\b/.test(text)) {
    // Claude 2 / instant historically weaker / no vision path in our usage
    if (/\bclaude[-_ ]?2\b|\bclaude[-_ ]?instant\b/.test(text)) {
      return false;
    }
    return true;
  }

  // Google Gemini multimodal
  if (/\bgemini\b/.test(text)) {
    if (/\b(embed|embedding|tts)\b/.test(text)) {
      return false;
    }
    return true;
  }

  // Qwen VL / Omni
  if (/\bqwen\b/.test(text) && /\b(vl|vision|omni|2\.5-vl|2-vl|3-vl)\b/.test(text)) {
    return true;
  }
  if (/\bqwen2(\.5)?-vl\b|\bqwen-vl\b|\bqwen3-vl\b/.test(text)) {
    return true;
  }

  // DeepSeek — official deepseek-v4-flash/chat are not general vision OCR models for captcha.
  // Only mark known VL-named variants.
  if (/\bdeepseek\b/.test(text)) {
    return /\b(vl|vision)\b/.test(text);
  }

  // Moonshot / Kimi
  if (/\b(moonshot|kimi)\b/.test(text)) {
    // kimi/moonshot chat often multimodal in recent versions; keep VL/vision explicit or kimi-latest/k1
    return /\b(vl|vision|kimi-latest|k1|k2)\b/.test(text) || /\bkimi[-_.]?(latest|k1|k2)\b/.test(text);
  }

  // GLM / Zhipu
  if (/\bglm[-_ ]?(4v|4\.1v|4\.5v|4v-plus|4-voice)\b/.test(text) || /\bglm-4v\b/.test(text)) {
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
    // Prefer explicit vision markers; also accept recent major grok-2/4 chat IDs commonly multimodal on gateways.
    return /\b(vision|2-vision)\b/.test(text) || /\bgrok-2\b/.test(text) || /\bgrok-4(\.|$|[-_])/.test(text);
  }

  // Stepfun / Yi VL
  if (/\b(step-1v|yi-vl|yi-vision)\b/.test(text)) {
    return true;
  }

  // Generic markers last
  if (/\b(vision|multimodal|omni)\b/.test(text) || /[-_]vl\b|\bvl[-_]|[-_]v\b.*vision/.test(text)) {
    return true;
  }

  return false;
}
