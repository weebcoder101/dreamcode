export interface PromptConfig {
  scanType: string
  files: Array<{ path: string; content: string }>
  context?: string
}

export interface PromptResult {
  systemPrompt: string
  userPrompt: string
  estimatedTokens: number
  scanType: string
  fileCount: number
}

const SYSTEM_PROMPTS: Record<string, string> = {
  full_audit: `You are an expert software architect reviewing a codebase.
Analyze the provided code for:
1. Architecture issues and anti-patterns
2. Security vulnerabilities
3. Performance bottlenecks
4. Code quality and maintainability
5. Testing gaps

Provide specific, actionable recommendations with file:line references.`,

  security: `You are a security expert reviewing code for vulnerabilities.
Focus on:
1. OWASP Top 10 vulnerabilities
2. Authentication/authorization flaws
3. Input validation issues
4. Secret/credential exposure
5. Dependency vulnerabilities

Provide specific fixes with code examples.`,

  bug_hunt: `You are a debugging expert analyzing code for bugs.
Focus on:
1. Logic errors and edge cases
2. Race conditions
3. Memory leaks
4. Error handling gaps
5. Type safety issues

Provide specific fixes with file:line references.`,

  test_gap: `You are a testing expert analyzing code coverage gaps.
Focus on:
1. Missing unit tests
2. Integration test gaps
3. Edge cases not covered
4. Error path testing
5. Performance testing needs

Provide specific test cases with examples.`,

  refactor: `You are a refactoring expert analyzing code for improvement opportunities.
Focus on:
1. Code duplication
2. Complex functions that should be broken down
3. Naming and clarity issues
4. Design pattern opportunities
5. Dependency management

Provide specific refactoring suggestions with before/after examples.`,
}

export function buildPrompt(config: PromptConfig): PromptResult {
  const systemPrompt = SYSTEM_PROMPTS[config.scanType] || SYSTEM_PROMPTS["full_audit"]

  const fileContents = config.files.map(f => {
    const path = f.path || "unknown"
    const content = f.content || ""
    return `## File: ${path}\n\`\`\`\n${content}\n\`\`\``
  })

  let userPrompt = `Analyze the following code:\n\n${fileContents.join("\n\n")}`
  if (config.context) {
    userPrompt += `\n\nAdditional context: ${config.context}`
  }

  const estimatedTokens = Math.ceil((systemPrompt.length + userPrompt.length) / 4)

  return {
    systemPrompt,
    userPrompt,
    estimatedTokens,
    scanType: config.scanType,
    fileCount: config.files.length,
  }
}

export function getSupportedScanTypes(): string[] {
  return Object.keys(SYSTEM_PROMPTS)
}
