import type { Ticket, ToolDefinition, ToolResult, AgentSynthesis, LLMMessage } from "../types.js";

export function buildPlanPrompt(
  ticket: Ticket,
  tools: ToolDefinition[],
  priorFindings: ToolResult[]
): LLMMessage[] {
  const toolDescriptions = tools.map((t) => {
    const params = Object.entries(t.parameters)
      .map(([name, p]) => `  - ${name} (${p.type}${p.required ? ", required" : ""}): ${p.description}`)
      .join("\n");
    return `### ${t.name}\n${t.description}\nParameters:\n${params}`;
  }).join("\n\n");

  const findingsSummary = priorFindings.length > 0
    ? `\n\n## Prior Investigation Results\n${priorFindings.map((f) =>
        `- ${f.tool}(${JSON.stringify(f.args)}): ${f.error ? `ERROR: ${f.error}` : JSON.stringify(f.result)}`
      ).join("\n")}`
    : "";

  return [
    {
      role: "system",
      content: `You are a support agent investigator. Your job is to plan what tools to call to investigate a customer support ticket.

## Available Tools
${toolDescriptions}

Respond with a JSON object:
{
  "reasoning": "Brief explanation of your investigation plan",
  "steps": [
    { "tool": "tool_name", "args": { "param": "value" }, "purpose": "Why this step" }
  ]
}

Rules:
- If the message is a greeting, small talk, thank you, or anything that does NOT require looking up data, return an EMPTY steps array. Do not call any tools for simple conversation.
- Only use tools that are listed above.
- Start with the most likely root cause.
- Use the customer's name (not numeric ID) when looking up their data.
- Plan 1-3 steps per round. Only call tools you actually need.
- If prior findings already explain the issue, return an empty steps array.`,
    },
    {
      role: "user",
      content: `## Support Ticket
**ID:** ${ticket.id}
**From:** ${ticket.customerEmail}${ticket.customerId ? ` (Customer ID: ${ticket.customerId})` : ""}
**Subject:** ${ticket.subject}
**Body:**
${ticket.body}
${findingsSummary}

Plan your next investigation steps.`,
    },
  ];
}

export function buildSynthesisPrompt(
  ticket: Ticket,
  findings: ToolResult[]
): LLMMessage[] {
  const findingsText = findings.map((f) =>
    `### ${f.tool}(${JSON.stringify(f.args)})
${f.error ? `ERROR: ${f.error}` : `Result: ${JSON.stringify(f.result, null, 2)}`}`
  ).join("\n\n");

  return [
    {
      role: "system",
      content: `You are a support agent synthesizer. Analyze investigation findings and determine if the issue can be resolved.

Respond with a JSON object:
{
  "answer": "The root cause and fix, if known",
  "confidence": 0.0-1.0,
  "reasoning": "Why you're confident or not",
  "needsMoreInvestigation": true/false,
  "nextSteps": [{ "tool": "...", "args": {}, "purpose": "..." }]  // only if needsMoreInvestigation is true
}

Confidence guide:
- 0.9+: Clear root cause found, specific fix identified
- 0.7-0.9: Likely cause found, reasonable fix
- 0.5-0.7: Partial understanding, might need human review
- <0.5: Insufficient information, escalate`,
    },
    {
      role: "user",
      content: `## Ticket
**Subject:** ${ticket.subject}
**Body:** ${ticket.body}
**Customer:** ${ticket.customerEmail}

## Investigation Findings
${findingsText}

Synthesize these findings.`,
    },
  ];
}

export function buildReplyPrompt(
  ticket: Ticket,
  synthesis: AgentSynthesis
): LLMMessage[] {
  return [
    {
      role: "system",
      content: `You are a friendly, professional support agent writing a reply to a customer.

Rules:
- Reply in the same language the customer used. If they wrote in Spanish, reply in Spanish.
- Be concise and direct. Lead with the answer or fix.
- If you found specific data about their account, reference it.
- Don't say "I investigated" or mention internal tools. Just present the answer naturally.
- If there are action items for the customer, list them clearly.
- Sign off warmly but briefly.
- Do NOT make up information. Only reference what was actually found.`,
    },
    {
      role: "user",
      content: `## Ticket
**Subject:** ${ticket.subject}
**Body:** ${ticket.body}

## What We Found
${synthesis.answer}

## Reasoning
${synthesis.reasoning}

Write the customer reply.`,
    },
  ];
}
