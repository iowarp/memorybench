import type {
  Provider,
  ProviderConfig,
  IngestOptions,
  IngestResult,
  SearchOptions,
  IndexingProgressCallback,
} from "../../types/provider"
import type { UnifiedSession } from "../../types/unified"
import { logger } from "../../utils/logger"
import { HINDSIGHT_PROMPTS } from "./prompts"

interface HindsightRecallResult {
  id: string
  text: string
  type: "world" | "experience" | "observation"
  entities?: string[]
  context?: string
  occurred_start?: string
  occurred_end?: string
  mentioned_at?: string
  document_id?: string
  metadata?: Record<string, string>
  tags?: string[]
}

interface HindsightRecallResponse {
  results: HindsightRecallResult[]
  entities?: Array<{
    id: string
    canonical_name: string
    observations?: Array<{ text: string; mentioned_at?: string }>
  }>
  usage?: { input_tokens: number; output_tokens: number; total_tokens: number }
}

interface HindsightRetainResponse {
  success: boolean
  bank_id: string
  items_count: number
  async: boolean
  operation_id?: string | null
}

export class HindsightProvider implements Provider {
  name = "hindsight"
  prompts = HINDSIGHT_PROMPTS
  concurrency = {
    default: 10,
    ingest: 5,
  }
  private baseUrl = ""
  private bankIds: Map<string, string> = new Map()

  async initialize(config: ProviderConfig): Promise<void> {
    this.baseUrl = config.baseUrl || process.env.HINDSIGHT_BASE_URL || "http://localhost:8888"
    // Verify server is reachable
    const resp = await fetch(`${this.baseUrl}/health`)
    if (!resp.ok) {
      throw new Error(`Hindsight health check failed: ${resp.status}`)
    }
    logger.info(`Initialized Hindsight provider at ${this.baseUrl}`)
  }

  async ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult> {
    const bankId = `memorybench_${options.containerTag.replace(/[^a-zA-Z0-9_-]/g, "_")}`
    this.bankIds.set(options.containerTag, bankId)

    // Create/ensure bank exists
    await fetch(`${this.baseUrl}/v1/default/banks/${bankId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: bankId }),
    })
    logger.debug(`Ensured bank exists: ${bankId}`)

    const documentIds: string[] = []

    for (const session of sessions) {
      const isoDate = session.metadata?.date as string | undefined

      // Format all messages in the session into a single content block
      const lines: string[] = []
      for (const msg of session.messages) {
        const speaker = msg.speaker || msg.role
        lines.push(`${speaker}: ${msg.content}`)
      }
      const content = lines.join("\n")

      const items = [
        {
          content,
          timestamp: isoDate || undefined,
          context: `conversation session ${session.sessionId}`,
          document_id: session.sessionId,
        },
      ]

      const resp = await fetch(`${this.baseUrl}/v1/default/banks/${bankId}/memories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, async: false }),
      })

      if (!resp.ok) {
        const text = await resp.text()
        logger.warn(`Failed to retain session ${session.sessionId}: ${resp.status} ${text}`)
        continue
      }

      const result = (await resp.json()) as HindsightRetainResponse
      if (result.success) {
        documentIds.push(session.sessionId)
      }
      logger.debug(`Ingested session ${session.sessionId} (${result.items_count} items)`)
    }

    return { documentIds }
  }

  async awaitIndexing(
    result: IngestResult,
    _containerTag: string,
    onProgress?: IndexingProgressCallback
  ): Promise<void> {
    // Hindsight retain with async=false processes synchronously (LLM extraction during the call)
    onProgress?.({
      completedIds: result.documentIds,
      failedIds: [],
      total: result.documentIds.length,
    })
  }

  async search(query: string, options: SearchOptions): Promise<unknown[]> {
    const bankId = this.bankIds.get(options.containerTag)
    if (!bankId) {
      throw new Error(`No bank found for container ${options.containerTag}`)
    }

    const resp = await fetch(`${this.baseUrl}/v1/default/banks/${bankId}/memories/recall`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        budget: "mid",
        max_tokens: 8192,
        include: {
          entities: { max_tokens: 1000 },
        },
      }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Hindsight recall failed: ${resp.status} ${text}`)
    }

    const data = (await resp.json()) as HindsightRecallResponse
    const results: unknown[] = []

    for (const r of data.results) {
      results.push(r)
    }

    if (data.entities) {
      for (const entity of data.entities) {
        results.push({ ...entity, _type: "entity" })
      }
    }

    return results
  }

  async clear(containerTag: string): Promise<void> {
    const bankId = this.bankIds.get(containerTag)
    if (bankId) {
      const resp = await fetch(`${this.baseUrl}/v1/default/banks/${bankId}`, {
        method: "DELETE",
      })
      if (resp.ok) {
        logger.info(`Deleted bank: ${bankId}`)
      } else {
        logger.warn(`Failed to delete bank ${bankId}: ${resp.status}`)
      }
      this.bankIds.delete(containerTag)
    }
  }
}

export default HindsightProvider
