import type { Provider } from "../../types/provider"
import type { RunCheckpoint } from "../../types/checkpoint"
import { CheckpointManager } from "../checkpoint"
import { logger } from "../../utils/logger"
import { ParallelExecutor } from "../parallel"
import { resolveParallelism } from "../../types/parallelism"

export async function runIndexingPhase(
    provider: Provider,
    checkpoint: RunCheckpoint,
    checkpointManager: CheckpointManager,
    questionIds?: string[]
): Promise<void> {
    const allQuestions = Object.values(checkpoint.questions)
    const targetQuestions = questionIds
        ? allQuestions.filter(q => questionIds.includes(q.questionId))
        : allQuestions

    const toIndex = targetQuestions.filter(q =>
        q.phases.ingest.status === "completed" &&
        q.phases.indexing.status !== "completed"
    )

    if (toIndex.length === 0) {
        logger.info("No questions pending indexing")
        return
    }

    const concurrency = resolveParallelism(
        "indexing",
        checkpoint.parallelism,
        provider.defaultParallelism
    )

    logger.info(`Awaiting indexing for ${toIndex.length} questions (concurrency: ${concurrency})...`)

    await ParallelExecutor.executeParallel(
        toIndex,
        concurrency,
        checkpoint.runId,
        "indexing",
        async ({ item: question, index, total }) => {
            const ingestResult = question.phases.ingest.ingestResult

            if (!ingestResult || (ingestResult.documentIds.length === 0 && !ingestResult.taskIds?.length)) {
                checkpointManager.updatePhase(checkpoint, question.questionId, "indexing", {
                    status: "completed",
                    completedAt: new Date().toISOString(),
                    durationMs: 0,
                })
                logger.progress(index + 1, total, `Indexed ${question.questionId} (0ms)`)
                return { questionId: question.questionId, durationMs: 0 }
            }

            const startTime = Date.now()
            checkpointManager.updatePhase(checkpoint, question.questionId, "indexing", {
                status: "in_progress",
                startedAt: new Date().toISOString(),
            })

            try {
                await provider.awaitIndexing(ingestResult, question.containerTag)

                const durationMs = Date.now() - startTime
                checkpointManager.updatePhase(checkpoint, question.questionId, "indexing", {
                    status: "completed",
                    completedAt: new Date().toISOString(),
                    durationMs,
                })

                logger.progress(index + 1, total, `Indexed ${question.questionId} (${durationMs}ms)`)
                return { questionId: question.questionId, durationMs }
            } catch (e) {
                const error = e instanceof Error ? e.message : String(e)
                checkpointManager.updatePhase(checkpoint, question.questionId, "indexing", {
                    status: "failed",
                    error,
                })
                logger.error(`Failed to index ${question.questionId}: ${error}`)
                throw new Error(`Indexing failed at ${question.questionId}: ${error}. Fix the issue and resume with the same run ID.`)
            }
        }
    )

    logger.success("Indexing phase complete")
}
