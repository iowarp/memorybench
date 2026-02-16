import type { ProviderPrompts } from "../../types/prompts"

interface CteSession {
  sessionId: string
  messages: Array<{ role: string; content: string; speaker?: string; timestamp?: string }>
  metadata?: Record<string, unknown>
}

function buildCteContext(context: unknown[]): string {
  const sessions = context as CteSession[]
  return sessions
    .map((session, i) => {
      const date = session.metadata?.formattedDate || session.metadata?.date || ""
      const header = date
        ? `Session ${i + 1} (${session.sessionId}) — ${date}:`
        : `Session ${i + 1} (${session.sessionId}):`

      const messages = session.messages
        .map((m) => {
          const speaker = m.speaker || m.role
          return `  ${speaker}: ${m.content}`
        })
        .join("\n")

      return `${header}\n${messages}`
    })
    .join("\n\n---\n\n")
}

export function buildCteAnswerPrompt(
  question: string,
  context: unknown[],
  questionDate?: string
): string {
  const retrievedContext = buildCteContext(context)

  return `You are a question-answering system. Based on the retrieved conversation sessions below, answer the question.

Question: ${question}
Question Date: ${questionDate || "Not specified"}

Retrieved Sessions:
${retrievedContext}

**How to Answer:**
1. Scan through all conversation sessions above
2. Identify which sessions and messages are relevant to the question
3. Pay attention to dates, speakers, and temporal relationships
4. Synthesize information from multiple sessions if needed

Instructions:
- First, think through the problem step by step. Show your reasoning process.
- Identify which parts of the context are relevant to answering the question
- Consider temporal relationships, sequences of events, and any updates to information over time
- If the context contains enough information to answer the question, provide a clear, concise answer
- If the context does not contain enough information, respond with "I don't know" or explain what information is missing
- Base your answer ONLY on the provided context

**Response Format:**
Think step by step, then provide your answer.

Reasoning:
[Your step-by-step reasoning process here]

Answer:
[Your final answer here]`
}

export const CTE_PROMPTS: ProviderPrompts = {
  answerPrompt: buildCteAnswerPrompt,
}

export default CTE_PROMPTS
