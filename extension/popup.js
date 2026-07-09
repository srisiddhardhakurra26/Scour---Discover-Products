const DEFAULT_BASE = 'http://localhost:3000'

const input = document.getElementById('base')
const status = document.getElementById('status')
const saveBtn = document.getElementById('save')

chrome.storage.sync.get({ scourBaseUrl: DEFAULT_BASE }, (data) => {
  input.value = data.scourBaseUrl || DEFAULT_BASE
})

saveBtn.addEventListener('click', () => {
  let url = (input.value || '').trim().replace(/\/$/, '')
  if (!url) url = DEFAULT_BASE
  try {
    // Validate
    // eslint-disable-next-line no-new
    new URL(url)
  } catch {
    status.textContent = 'Invalid URL'
    status.style.color = '#f87171'
    return
  }
  chrome.storage.sync.set({ scourBaseUrl: url }, () => {
    status.textContent = 'Saved'
    status.style.color = '#86efac'
  })
})
