import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { fileURLToPath } from 'url'
import path from 'path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const app = express()
app.use(cors())
app.use(express.json({ limit: '15mb' }))
app.use(express.static(path.join(__dirname, 'dist')))

function parseReceiptText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  // --- Date ---
  let date = null
  for (const line of lines) {
    let m = line.match(/令和\s*(\d+)年\s*(\d{1,2})月\s*(\d{1,2})日/)
    if (m) { date = `${2018 + +m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break }

    m = line.match(/R(\d+)[.\/\-](\d{1,2})[.\/\-](\d{1,2})/)
    if (m) { date = `${2018 + +m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break }

    m = line.match(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})日?/)
    if (m) { date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break }
  }

  // --- Amount (合計行を優先、なければ最大金額) ---
  let amount = null
  const totalKw = /合[　 ]?計|お会計|請求[　 ]?額|お支払[　 ]?金額|total/i
  for (const line of lines) {
    if (totalKw.test(line)) {
      const m = line.match(/([1-9][0-9,]*)/)
      if (m) { amount = parseInt(m[1].replace(/,/g, ''), 10); if (amount > 0) break }
    }
  }
  if (!amount) {
    let max = 0
    for (const line of lines) {
      for (const m of line.matchAll(/[¥￥]?\s*([1-9][0-9,]{2,})/g)) {
        const v = parseInt(m[1].replace(/,/g, ''), 10)
        if (v > max) max = v
      }
    }
    if (max > 0) amount = max
  }

  // --- Store name (先頭の意味ある行) ---
  let storeName = null
  const skipLine = [
    /^[\d\s\-\/\.]+$/,
    /^[¥￥]/,
    /^(領収書|御領収書|レシート|receipt)/i,
    /^(tel|fax|〒|\d{3}[-\d])/i,
    /合計|小計|税/,
  ]
  for (const line of lines) {
    if (line.length < 2) continue
    if (skipLine.some(p => p.test(line))) continue
    storeName = line
    break
  }

  return { date, amount, storeName }
}

app.post('/api/analyze-receipt', async (req, res) => {
  const { imageData } = req.body
  if (!imageData) return res.status(400).json({ error: '画像データが見つかりません' })

  const apiKey = process.env.GOOGLE_VISION_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_VISION_API_KEY が設定されていません' })

  try {
    const visionRes = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [{
            image: { content: imageData },
            features: [{ type: 'TEXT_DETECTION' }]
          }]
        })
      }
    )

    const visionData = await visionRes.json()
    if (visionData.error) throw new Error(visionData.error.message)

    const fullText = visionData.responses?.[0]?.fullTextAnnotation?.text ?? ''
    if (!fullText) return res.json({ date: null, amount: null, storeName: null })

    res.json(parseReceiptText(fullText))
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`))
