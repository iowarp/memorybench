import { resolve, dirname } from "path"
import { fileURLToPath } from "url"
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
import { CTE_PROMPTS } from "./prompts"
import {
  cteInit,
  cteTagNew,
  cteTagPutBlob,
  cteTagGetBlobSize,
  cteTagGetBlob,
  cteTagGetContainedBlobs,
  cteDelTag,
  type TagHandle,
} from "./ffi"

const __dirname = dirname(fileURLToPath(import.meta.url))

export class CteProvider implements Provider {
  name = "cte"
  prompts = CTE_PROMPTS
  concurrency = {
    default: 1,
    ingest: 1,
    indexing: 1,
  }
  private initialized = false

  async initialize(config: ProviderConfig): Promise<void> {
    // Set CTE config via environment before init
    if (!process.env.CHI_SERVER_CONF) {
      // Default to the bundled RAM-only config
      process.env.CHI_SERVER_CONF = resolve(__dirname, "../../../cte_config.yaml")
    }
    if (!process.env.CHI_WITH_RUNTIME) {
      process.env.CHI_WITH_RUNTIME = "1"
    }

    logger.info(`CTE config: ${process.env.CHI_SERVER_CONF}`)
    cteInit("")

    this.initialized = true
    logger.info("Initialized CTE provider")
  }

  async ingest(sessions: UnifiedSession[], options: IngestOptions): Promise<IngestResult> {
    if (!this.initialized) throw new Error("Provider not initialized")

    const tag = cteTagNew(options.containerTag)
    const documentIds: string[] = []

    try {
      for (const session of sessions) {
        const payload = JSON.stringify(session)
        const data = Buffer.from(payload, "utf-8")
        cteTagPutBlob(tag, session.sessionId, data)
        documentIds.push(session.sessionId)
        logger.debug(`Ingested session ${session.sessionId}`)
      }
    } finally {
      tag.free()
    }

    return { documentIds }
  }

  async awaitIndexing(
    result: IngestResult,
    _containerTag: string,
    onProgress?: IndexingProgressCallback
  ): Promise<void> {
    // CTE storage is synchronous — no indexing step needed
    onProgress?.({
      completedIds: result.documentIds,
      failedIds: [],
      total: result.documentIds.length,
    })
  }

  async search(query: string, options: SearchOptions): Promise<unknown[]> {
    if (!this.initialized) throw new Error("Provider not initialized")

    let tag: TagHandle | null = null
    try {
      tag = cteTagNew(options.containerTag)
      const blobNames = cteTagGetContainedBlobs(tag)

      const sessions: unknown[] = []
      for (const blobName of blobNames) {
        const size = cteTagGetBlobSize(tag, blobName)
        if (size === 0) continue
        const buf = cteTagGetBlob(tag, blobName, size)
        try {
          sessions.push(JSON.parse(buf.toString("utf-8")))
        } catch {
          logger.warn(`Failed to parse blob ${blobName} as JSON`)
        }
      }

      return sessions
    } finally {
      tag?.free()
    }
  }

  async clear(containerTag: string): Promise<void> {
    if (!this.initialized) throw new Error("Provider not initialized")
    cteDelTag(containerTag)
    logger.info(`Deleted tag: ${containerTag}`)
  }
}

export default CteProvider
