# Scour browser extension

On Amazon / eBay / Etsy / Best Buy (and Walmart / Target) **product pages**, shows a floating panel: same product cheaper elsewhere via your Scour instance.

## Install (Chrome / Edge / Brave)

1. Run Scour locally: `npm run dev` → http://localhost:3000
2. Open `chrome://extensions` → enable **Developer mode**
3. **Load unpacked** → select this `extension/` folder
4. Click the Scour icon → confirm base URL (`http://localhost:3000`)
5. Open any product page on a supported store

## How it works

```
content script (read title/price)
    → background service worker
        → POST /api/lookup
            → fan-out search across Scour adapters
    → overlay panel (cheapest + alternatives + “Open in Scour”)
```

## Files

| File | Role |
|------|------|
| `manifest.json` | MV3 config + site matches |
| `content.js` / `content.css` | Extract product + draw overlay |
| `background.js` | Call Scour `/api/lookup` |
| `popup.html` / `popup.js` | Set Scour base URL |

## Notes

- Needs Scour running; missing adapters/API keys degrade gracefully.
- Overlay only on product-like URLs (not search result pages).
- Point the popup URL at a deployed Scour host if not using localhost.
