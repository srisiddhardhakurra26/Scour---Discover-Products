import assert from 'node:assert/strict'
import test from 'node:test'
import { readJsonLimited, readTextLimited } from './http'

test('reads bounded text and JSON responses', async () => {
  assert.equal(await readTextLimited(new Response('hello'), 10), 'hello')
  assert.deepEqual(await readJsonLimited<{ ok: boolean }>(new Response('{"ok":true}'), 20), {
    ok: true,
  })
})

test('rejects oversized remote responses', async () => {
  await assert.rejects(() => readTextLimited(new Response('too large'), 3), /exceeds/)
  await assert.rejects(
    () =>
      readTextLimited(
        new Response('x', { headers: { 'content-length': '100' } }),
        10,
      ),
    /exceeds/,
  )
})
