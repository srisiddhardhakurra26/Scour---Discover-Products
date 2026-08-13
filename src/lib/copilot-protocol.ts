export const COPILOT_TOOL_NAMES = [
  'search_products',
  'find_cheaper',
  'run_shopping_mission',
  'list_sources',
] as const

export type CopilotToolName = (typeof COPILOT_TOOL_NAMES)[number]

export type CopilotProductPreview = {
  title: string
  price: string
  store: string
  url: string
  imageUrl?: string
}

export type CopilotToolPresentation = {
  name: CopilotToolName
  label: string
  summary: string
  href?: string
  products: CopilotProductPreview[]
}

export type CopilotStreamEvent =
  | { type: 'status'; message: string }
  | { type: 'tool'; tool: CopilotToolPresentation }
  | { type: 'text'; delta: string }
  | { type: 'error'; message: string }
