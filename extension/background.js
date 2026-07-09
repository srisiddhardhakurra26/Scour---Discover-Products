// Service worker: talks to the Scour instance (no CORS pain from content scripts).

const DEFAULT_BASE = 'http://localhost:3000'

async function getBaseUrl() {
  const { scourBaseUrl } = await chrome.storage.sync.get({ scourBaseUrl: DEFAULT_BASE })
  return String(scourBaseUrl || DEFAULT_BASE).replace(/\/$/, '')
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'scour-lookup') return false

  ;(async () => {
    try {
      const base = await getBaseUrl()
      const res = await fetch(`${base}/api/lookup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(message.payload ?? {}),
      })
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}))
        sendResponse({
          ok: false,
          error: errBody.error || `Scour returned ${res.status}`,
          baseUrl: base,
        })
        return
      }
      const data = await res.json()
      sendResponse({ ok: true, data, baseUrl: base })
    } catch (err) {
      sendResponse({
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Could not reach Scour. Is it running? Check the extension popup URL.',
      })
    }
  })()

  return true // keep the message channel open for async sendResponse
})
