export const AI_CONFIG_STATES = {
  UNCONFIGURED: "unconfigured",
  CONFIGURED: "configured",
  VALID: "valid",
  INVALID: "invalid",
  DEGRADED: "degraded",
};

const normalizeText = (value) => (typeof value === "string" ? value.trim() : "");

const hasSavedCoreConfig = (settings) => Boolean(
  normalizeText(settings?.endpoint)
  && normalizeText(settings?.apiKey)
  && normalizeText(settings?.model),
);

const hasPassingHealthCheck = (runtimeState) => normalizeText(runtimeState?.lastTestStatus) === "passed";

const hasFailingHealthCheck = (runtimeState) => normalizeText(runtimeState?.lastTestStatus) === "failed";

const hasRuntimeDegradation = (runtimeState) => Boolean(normalizeText(runtimeState?.lastRuntimeErrorMessage));

export const deriveAiConfigState = (settings = {}, runtimeState = {}) => {
  if (!hasSavedCoreConfig(settings)) {
    return AI_CONFIG_STATES.UNCONFIGURED;
  }

  if (hasRuntimeDegradation(runtimeState)) {
    return AI_CONFIG_STATES.DEGRADED;
  }

  if (hasPassingHealthCheck(runtimeState)) {
    return AI_CONFIG_STATES.VALID;
  }

  if (hasFailingHealthCheck(runtimeState)) {
    return AI_CONFIG_STATES.INVALID;
  }

  return AI_CONFIG_STATES.CONFIGURED;
};

export const normalizeAiConfigStateValue = (value) => {
  const normalized = normalizeText(value);
  const stateValues = new Set(Object.values(AI_CONFIG_STATES));
  return stateValues.has(normalized) ? normalized : "";
};

export const createDefaultAiConfigRuntimeState = () => ({
  protocol: "",
  configState: AI_CONFIG_STATES.UNCONFIGURED,
  lastTestStatus: "",
  lastTestMessage: "",
  lastTestAt: "",
  lastRuntimeErrorMessage: "",
  lastRuntimeErrorAt: "",
});
