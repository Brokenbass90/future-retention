/**
 * Task-based OpenAI model routing.
 *
 * Lets the studio use a stronger model only for layout/design-heavy steps
 * while keeping routine chat and utility tasks on cheaper models.
 */

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

const DEFAULT_OPENAI_MODEL = cleanText(process.env.OPENAI_MODEL) || "gpt-4.1-mini";

const TASK_MODEL_ENV = {
  default: ["OPENAI_MODEL"],
  draft: ["OPENAI_MODEL_DRAFT", "OPENAI_MODEL_ASSEMBLY", "OPENAI_MODEL"],
  designAnalysis: ["OPENAI_MODEL_DESIGN_ANALYSIS", "OPENAI_MODEL_LAYOUT", "OPENAI_MODEL_VERSTKA", "OPENAI_MODEL"],
  discussion: ["OPENAI_MODEL_DISCUSSION", "OPENAI_MODEL_CHAT", "OPENAI_MODEL"],
  translations: ["OPENAI_MODEL_TRANSLATIONS", "OPENAI_MODEL_TRANSLATION", "OPENAI_MODEL"],
  cloneEdit: ["OPENAI_MODEL_CLONE_EDIT", "OPENAI_MODEL_DRAFT", "OPENAI_MODEL"],
  followupEdit: ["OPENAI_MODEL_FOLLOWUP_EDIT", "OPENAI_MODEL_DRAFT", "OPENAI_MODEL"]
};

function resolveFromEnv(keys = []) {
  for (const key of keys) {
    const value = cleanText(process.env[key]);
    if (value) {
      return value;
    }
  }
  return "";
}

export function resolveOpenAiModelForTask(task = "default") {
  const normalizedTask = cleanText(task) || "default";
  return resolveFromEnv(TASK_MODEL_ENV[normalizedTask] || TASK_MODEL_ENV.default) || DEFAULT_OPENAI_MODEL;
}

export function summarizeOpenAiModelRouting() {
  return {
    default: resolveOpenAiModelForTask("default"),
    discussion: resolveOpenAiModelForTask("discussion"),
    draft: resolveOpenAiModelForTask("draft"),
    designAnalysis: resolveOpenAiModelForTask("designAnalysis"),
    translations: resolveOpenAiModelForTask("translations"),
    cloneEdit: resolveOpenAiModelForTask("cloneEdit"),
    followupEdit: resolveOpenAiModelForTask("followupEdit")
  };
}
