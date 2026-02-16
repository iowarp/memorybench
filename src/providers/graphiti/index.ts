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
import { GRAPHITI_PROMPTS } from "./prompts"

interface GraphitiMessage {
  content: string
  uuid?: string
  name?: string
  role_type: "user" | "assistant" | "system"
  role?: string
  timestamp?: string
  source_description?: string
}

export interface GraphitiFactResult {
  uuid: string
  name: string
  fact: string
  valid_at: string | null
  invalid_at: string | null
  created_at: string
  expired_at: string | null
}

interface GraphitiSearchResponse {
  facts: GraphitiFactResult[]
}

export class GraphitiProvider implements Provider {
  name = "graphiti"
  prompts = GRAPHITI_PROMPTS
  concurrency = {
    default: 5,
    ingest: 3,
  }
  private baseUrl = ""
  private groupIds: Map<string, string> = new Map()

  async initialize(config: ProviderConfig): Promise<void> {
    this.baseUrl = config.baseUrl || process.env.GRAPHITI_BASE_URL || "http://localhost:8000"
    const resp = await fetch(`${this.baseUrl}/healthcheck`)
    if (!resp.ok) {
      throw new Error(`Graphiti healthcheck failed: ${resp.status}`)
    }
    logger.info(`Initialized Graphiti provider at ${this.baseUrl}`)
  }

  async ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult> {
    const groupId = `memorybench_${options.containerTag.replace(/[^a-zA-Z0-9_-]/g, "_")}`
    this.groupIds.set(options.containerTag, groupId)

    const documentIds: string[] = []

    for (const session of sessions) {
      const isoDate = session.metadata?.date as string | undefined

      const messages: GraphitiMessage[] = session.messages.map((msg) => ({
        content: msg.content,
        role_type: msg.role === "user" ? "user" : "assistant",
        role: msg.speaker || msg.role,
        timestamp: msg.timestamp || isoDate || new Date().toISOString(),
        source_description: `session ${session.sessionId}`,
      }))

      const resp = await fetch(`${this.baseUrl}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          group_id: groupId,
          messages,
        }),
      })

      if (!resp.ok) {
        const text = await resp.text()
        logger.warn(`Failed to ingest session ${session.sessionId}: ${resp.status} ${text}`)
        continue
      }

      documentIds.push(session.sessionId)
      logger.debug(`Ingested session ${session.sessionId} (${messages.length} messages)`)
    }

    return { documentIds, taskIds: [groupId] }
  }

  async awaitIndexing(
    result: IngestResult,
    _containerTag: string,
    onProgress?: IndexingProgressCallback
  ): Promise<void> {
    // Graphiti processes messages asynchronously via its internal queue.
    // Poll episodes endpoint until the count stabilizes.
    const groupId = result.taskIds?.[0]
    if (!groupId) {
      onProgress?.({ completedIds: result.documentIds, failedIds: [], total: result.documentIds.length })
      return
    }

    const total = result.documentIds.length
    let stableCount = 0
    let lastEpisodeCount = -1
    let backoffMs = 2000

    onProgress?.({ completedIds: [], failedIds: [], total })

    while (stableCount < 3) {
      await new Promise((r) => setTimeout(r, backoffMs))

      try {
        const resp = await fetch(
          `${this.baseUrl}/episodes/${groupId}?last_n=1000`
        )
        if (!resp.ok) {
          logger.debug(`Episode poll returned ${resp.status}, retrying...`)
          continue
        }

        const episodes = (await resp.json()) as unknown[]
        const currentCount = episodes.length

        if (currentCount === lastEpisodeCount && currentCount > 0) {
          stableCount++
          logger.debug(
            `Episode count stable at ${currentCount} (${stableCount}/3)`
          )
        } else {
          stableCount = 0
          lastEpisodeCount = currentCount
          logger.debug(`Episode count: ${currentCount}, waiting...`)
        }
      } catch (e) {
        logger.debug(`Episode poll error: ${e}, retrying...`)
      }

      backoffMs = Math.min(backoffMs * 1.2, 10000)
    }

    onProgress?.({
      completedIds: result.documentIds,
      failedIds: [],
      total,
    })
  }

  async search(query: string, options: SearchOptions): Promise<unknown[]> {
    const groupId = this.groupIds.get(options.containerTag)
    if (!groupId) {
      throw new Error(`No group found for container ${options.containerTag}`)
    }

    const resp = await fetch(`${this.baseUrl}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        group_ids: [groupId],
        max_facts: options.limit || 20,
      }),
    })

    if (!resp.ok) {
      const text = await resp.text()
      throw new Error(`Graphiti search failed: ${resp.status} ${text}`)
    }

    const data = (await resp.json()) as GraphitiSearchResponse
    return data.facts || []
  }

  async clear(containerTag: string): Promise<void> {
    const groupId = this.groupIds.get(containerTag)
    if (groupId) {
      const resp = await fetch(`${this.baseUrl}/group/${groupId}`, {
        method: "DELETE",
      })
      if (resp.ok) {
        logger.info(`Deleted group: ${groupId}`)
      } else {
        logger.warn(`Failed to delete group ${groupId}: ${resp.status}`)
      }
      this.groupIds.delete(containerTag)
    }
  }
}

export default GraphitiProvider
