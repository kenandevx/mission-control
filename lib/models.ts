// Shared model utilities — the actual model list is fetched from /api/models
// Use useModels() in React components or fetch /api/models directly.

export function getProviderLabel(modelId: string): string {
  if (modelId.startsWith("anthropic/")) return "Anthropic";
  if (modelId.startsWith("openrouter/openai/")) return "OpenAI";
  if (modelId.startsWith("openrouter/google/")) return "Google";
  if (modelId.startsWith("openrouter/deepseek/")) return "DeepSeek";
  if (modelId.startsWith("openrouter/minimax/")) return "MiniMax";
  if (modelId.startsWith("openrouter/mistralai/")) return "Mistral";
  if (modelId.startsWith("openrouter/qwen/")) return "Qwen";
  if (modelId.startsWith("openrouter/stepfun/")) return "StepFun";
  if (modelId === "openrouter/auto") return "OpenRouter";
  if (modelId === "openai-codex/gpt-5.4" || modelId === "openai-codex/gpt-5.3-codex") return "OpenAI";
  return "Other";
}
