import assert from 'node:assert/strict'
import test from 'node:test'
import { presentToolResult } from './copilot-mcp'
import {
  fallbackCopilotTool,
  parseCopilotDecision,
} from './llm/copilot-planner'

test('planner output is constrained before an MCP tool call', () => {
  const decision = parseCopilotDecision(
    JSON.stringify({
      tool: 'search_products',
      arguments: { query: 'wireless earbuds under $80', max_results: 999 },
    }),
  )
  assert.deepEqual(decision, {
    kind: 'tool',
    call: {
      name: 'search_products',
      arguments: { query: 'wireless earbuds under $80', max_results: 10 },
    },
  })
  assert.throws(() =>
    parseCopilotDecision('{"tool":"delete_database","arguments":{}}'),
  )
})

test('deterministic routing keeps product search useful without an LLM key', () => {
  assert.deepEqual(
    fallbackCopilotTool(
      [{ role: 'user', content: 'Find noise-canceling headphones under $150' }],
      '',
    ),
    {
      name: 'search_products',
      arguments: { query: 'noise-canceling headphones under $150', max_results: 6 },
    },
  )
  assert.equal(
    fallbackCopilotTool(
      [{ role: 'user', content: 'Which of these is the best deal?' }],
      'headphones',
    ),
    null,
  )
})

test('search tool results become safe product cards', () => {
  const view = presentToolResult('search_products', {
    query: 'headphones',
    storesSearched: 8,
    storesHit: 2,
    scourUrl: 'http://localhost:3000/search?q=headphones',
    results: [
      {
        title: 'Example Headphones',
        price: '$99.00',
        store: 'Example Store',
        url: 'https://shop.example/item',
        imageUrl: 'javascript:alert(1)',
      },
    ],
  })
  assert.equal(view.products.length, 1)
  assert.equal(view.products[0].imageUrl, undefined)
  assert.equal(view.products[0].price, '$99.00')
  assert.match(view.summary, /2 of 8 stores/)
})
