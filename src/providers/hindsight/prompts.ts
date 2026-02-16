import type { ProviderPrompts } from "../../types/prompts"

interface HindsightResult {
  _type?: string
  text?: string
  type?: string
  entities?: string[]
  context?: string
  occurred_start?: string
  occurred_end?: string
  mentioned_at?: string
  canonical_name?: string
  observations?: Array<{ text: string; mentioned_at?: string }>
}

function buildHindsightContext(context: unknown[]): string {
  const worldFacts: string[] = []
  const experiences: string[] = []
  const observations: string[] = []
  const entitySummaries: string[] = []

  for (const r of context) {
    const result = r as HindsightResult

    if (result._type === "entity") {
      const name = result.canonical_name || "Unknown"
      const obs = (result.observations || [])
        .map((o) => `    - ${o.text} (${o.mentioned_at || "unknown time"})`)
        .join("\n")
      entitySummaries.push(`  ${name}:\n${obs}`)
      continue
    }

    const content = result.text || JSON.stringify(r)
    const timeInfo = result.occurred_start || result.mentioned_at || "unknown time"
    const entry = `  - ${content} (time: ${timeInfo})`

    switch (result.type) {
      case "world":
        worldFacts.push(entry)
        break
      case "experience":
        experiences.push(entry)
        break
      case "observation":
        observations.push(entry)
        break
      default:
        worldFacts.push(entry)
    }
  }

  let contextStr = ""

  if (worldFacts.length > 0) {
    contextStr += `# World Facts (general knowledge and established truths)
<WORLD_FACTS>
${worldFacts.join("\n")}
</WORLD_FACTS>

`
  }

  if (experiences.length > 0) {
    contextStr += `# Experiences (memories about conversations and actions)
<EXPERIENCES>
${experiences.join("\n")}
</EXPERIENCES>

`
  }

  if (observations.length > 0) {
    contextStr += `# Observations (consolidated knowledge)
<OBSERVATIONS>
${observations.join("\n")}
</OBSERVATIONS>

`
  }

  if (entitySummaries.length > 0) {
    contextStr += `# Entities (people, places, things mentioned)
<ENTITIES>
${entitySummaries.join("\n")}
</ENTITIES>

`
  }

  return contextStr.trim()
}

export function buildHindsightAnswerPrompt(
  question: string,
  context: unknown[],
  questionDate?: string
): string {
  const contextStr = buildHindsightContext(context)

  return `# CONTEXT:
You have access to categorized memories retrieved from a conversation history.

# INSTRUCTIONS:
1. Carefully analyze all provided memories across all categories
2. Pay special attention to timestamps to determine when events occurred
3. If the question asks about a specific event or fact, look for direct evidence
4. If memories contain contradictory information, prioritize the most recent memory
5. Always convert relative time references to specific dates, months, or years
6. Be as specific as possible when talking about people, places, and events
7. Timestamps represent the actual time the event occurred, not when it was mentioned

Clarification:
When interpreting memories, use the timestamp to determine when the described event happened.

Example:
Memory: (2023-03-15T16:33:00Z) I went to the vet yesterday.
Question: What day did I go to the vet?
Correct Answer: March 15, 2023
Explanation: The timestamp shows the event was recorded on March 15th, so that is the actual vet visit date.

# APPROACH (Think step by step):
1. Examine all memories that contain information related to the question
2. Check timestamps and content carefully
3. Look for explicit mentions of dates, times, locations, or events
4. If the answer requires calculation, show your work
5. Formulate a precise answer based solely on the evidence
6. Double-check that your answer directly addresses the question

Question Date: ${questionDate || "Not specified"}

${contextStr}

Question: ${question}
Answer:`
}

export const HINDSIGHT_PROMPTS: ProviderPrompts = {
  answerPrompt: buildHindsightAnswerPrompt,
}
