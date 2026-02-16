import type { ProviderPrompts } from "../../types/prompts"

interface GraphitiFactResult {
  uuid?: string
  name?: string
  fact?: string
  valid_at?: string | null
  invalid_at?: string | null
  created_at?: string
  expired_at?: string | null
}

function buildGraphitiContext(context: unknown[]): string {
  const facts: string[] = []

  for (const r of context) {
    const result = r as GraphitiFactResult
    const content = result.fact || JSON.stringify(r)
    const validAt = result.valid_at || "unknown"
    const invalidAt = result.invalid_at
    const relationship = result.name || ""

    let temporal = `valid_at: ${validAt}`
    if (invalidAt) {
      temporal += `, invalid_at: ${invalidAt} (superseded)`
    }

    const relInfo = relationship ? ` [${relationship}]` : ""
    facts.push(`  - ${content}${relInfo} (${temporal})`)
  }

  return `# These are facts extracted from a temporally-aware knowledge graph.
# Each fact has bi-temporal metadata:
#   valid_at: when the fact became true in the real world
#   invalid_at: when the fact stopped being true (if superseded by newer info)
# Facts without invalid_at are currently valid.
# Timestamps represent the actual time the event occurred, not when it was recorded.

<FACTS>
${facts.join("\n")}
</FACTS>`
}

export function buildGraphitiAnswerPrompt(
  question: string,
  context: unknown[],
  questionDate?: string
): string {
  const contextStr = buildGraphitiContext(context)

  return `# CONTEXT:
You have access to facts from a temporally-aware knowledge graph.

# INSTRUCTIONS:
1. Carefully analyze all provided facts and their temporal metadata
2. Pay special attention to valid_at timestamps to determine when events occurred
3. Facts with invalid_at have been superseded -- prefer currently-valid facts
4. If the question asks about a specific event or fact, look for direct evidence
5. If facts contain contradictory information, the one without invalid_at is current
6. Always convert relative time references to specific dates, months, or years
7. Be as specific as possible when talking about people, places, and events

Clarification:
When interpreting facts, use the valid_at timestamp to determine when the described event happened.

Example:
Fact: Alice works at Google (valid_at: 2023-01-15, invalid_at: 2023-06-01)
Fact: Alice works at Meta (valid_at: 2023-06-01)
Question: Where does Alice work?
Correct Answer: Meta (since the Google fact was superseded)

# APPROACH (Think step by step):
1. Examine all facts that contain information related to the question
2. Check temporal metadata (valid_at, invalid_at) carefully
3. Determine which facts are currently valid vs superseded
4. Look for explicit mentions of dates, times, locations, or events
5. If the answer requires temporal reasoning, show your work
6. Formulate a precise answer based solely on the evidence
7. Double-check that your answer directly addresses the question

Question Date: ${questionDate || "Not specified"}

${contextStr}

Question: ${question}
Answer:`
}

export const GRAPHITI_PROMPTS: ProviderPrompts = {
  answerPrompt: buildGraphitiAnswerPrompt,
}
