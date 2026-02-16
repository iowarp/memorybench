export interface Config {
  supermemoryApiKey: string
  supermemoryBaseUrl: string
  mem0ApiKey: string
  zepApiKey: string
  hindsightBaseUrl: string
  graphitiBaseUrl: string
  openaiApiKey: string
  anthropicApiKey: string
  googleApiKey: string
}

export const config: Config = {
  supermemoryApiKey: process.env.SUPERMEMORY_API_KEY || "",
  supermemoryBaseUrl: process.env.SUPERMEMORY_BASE_URL || "https://api.supermemory.ai",
  mem0ApiKey: process.env.MEM0_API_KEY || "",
  zepApiKey: process.env.ZEP_API_KEY || "",
  hindsightBaseUrl: process.env.HINDSIGHT_BASE_URL || "http://localhost:8888",
  graphitiBaseUrl: process.env.GRAPHITI_BASE_URL || "http://localhost:8000",
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  googleApiKey: process.env.GOOGLE_API_KEY || "",
}

export function getProviderConfig(provider: string): { apiKey: string; baseUrl?: string } {
  switch (provider) {
    case "supermemory":
      return { apiKey: config.supermemoryApiKey, baseUrl: config.supermemoryBaseUrl }
    case "mem0":
      return { apiKey: config.mem0ApiKey }
    case "zep":
      return { apiKey: config.zepApiKey }
    case "cte":
      return { apiKey: "", baseUrl: process.env.CTE_LIB_PATH || "" }
    case "hindsight":
      return { apiKey: "", baseUrl: config.hindsightBaseUrl }
    case "graphiti":
      return { apiKey: "", baseUrl: config.graphitiBaseUrl }
    default:
      throw new Error(`Unknown provider: ${provider}`)
  }
}

export function getJudgeConfig(judge: string): { apiKey: string; model?: string } {
  switch (judge) {
    case "openai":
      return { apiKey: config.openaiApiKey }
    case "anthropic":
      return { apiKey: config.anthropicApiKey }
    case "google":
      return { apiKey: config.googleApiKey }
    default:
      throw new Error(`Unknown judge: ${judge}`)
  }
}
