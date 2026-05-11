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

    m = line.match(/平成\s*(\d+)年\s*(\d{1,2})月\s*(\d{1,2})日/)
    if (m) { date = `${1988 + +m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break }

    m = line.match(/R(\d+)[.\/\-](\d{1,2})[.\/\-](\d{1,2})/)
    if (m) { date = `${2018 + +m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break }

    m = line.match(/(\d{4})[年\/\-](\d{1,2})[月\/\-](\d{1,2})日?/)
    if (m) { date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break }

    m = line.match(/(\d{4})\.(\d{1,2})\.(\d{1,2})/)
    if (m) { date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`; break }
  }

  // --- Amount (合計行を優先、なければ最大金額) ---
  let amount = null

  // 西暦年・日付の数字・100円未満を除外
  function isLikelyAmount(n) {
    if (n < 100) return false
    if (n >= 1900 && n <= 2100) return false
    return true
  }
  const datePattern = /令和|平成|昭和|\d{4}[年\/\-]\d{1,2}[月\/\-]|R\d+[.\/\-]\d/

  const totalKw = /合[　 ]?計|お会計|請求[　 ]?額|お支払[　 ]?金額|total/i
  for (const line of lines) {
    if (totalKw.test(line)) {
      // ¥記号付きを優先、なければ3桁以上の数字
      const m = line.match(/[¥￥]\s*([1-9][0-9,]+)/) || line.match(/([1-9][0-9,]{2,})/)
      if (m) {
        const v = parseInt(m[1].replace(/,/g, ''), 10)
        if (isLikelyAmount(v)) { amount = v; break }
      }
    }
  }
  if (!amount) {
    let max = 0
    // まず¥記号付きの数字から探す（信頼度が高い）
    for (const line of lines) {
      if (datePattern.test(line)) continue
      for (const m of line.matchAll(/[¥￥]\s*([1-9][0-9,]{2,})/g)) {
        const v = parseInt(m[1].replace(/,/g, ''), 10)
        if (isLikelyAmount(v) && v > max) max = v
      }
    }
    // ¥付きで見つからなければ全数字から（日付行・年号除外）
    if (!max) {
      for (const line of lines) {
        if (datePattern.test(line)) continue
        for (const m of line.matchAll(/([1-9][0-9,]{2,})/g)) {
          const v = parseInt(m[1].replace(/,/g, ''), 10)
          if (isLikelyAmount(v) && v > max) max = v
        }
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

function suggestCategory(text, storeName) {
  const t = (text + ' ' + (storeName || '')).toLowerCase()
  if (/駅|電車|バス|タクシー|新幹線|jr|メトロ|suica|pasmo|乗車|運賃|交通/.test(t))
    return { main: 'ビジネス用', sub: '交通費' }
  if (/セミナー|研修|講座|勉強会|ウェビナー|workshop|スクール/.test(t))
    return { main: 'ビジネス用', sub: 'セミナー費' }
  if (/コンサル|顧問|相談|コーチング/.test(t))
    return { main: 'ビジネス用', sub: 'コンサル費' }
  if (/電話|通信|インターネット|wifi|docomo|au|softbank|携帯|スマホ/.test(t))
    return { main: 'ビジネス用', sub: '通信費' }
  if (/接待|会食|懇親|レストラン|居酒屋|ランチ|ディナー|カフェ/.test(t))
    return { main: 'ビジネス用', sub: '接待費' }
  if (/文具|事務|消耗|コピー|印刷|usb|ケーブル|トナー|用紙|文房具/.test(t))
    return { main: 'ビジネス用', sub: '消耗品' }
  if (/薬|病院|クリニック|医院|歯科|調剤|眼科|内科|外科|皮膚科/.test(t))
    return { main: '個人用', sub: '医療費' }
  if (/スーパー|コンビニ|食料|食品|弁当|惣菜|精肉|鮮魚|青果/.test(t))
    return { main: '個人用', sub: '食費' }
  if (/ドラッグ|日用品|雑貨|洗剤|ホームセンター/.test(t))
    return { main: '個人用', sub: '日用品' }
  return null
}

app.post('/api/analyze-receipt', async (req, res) => {
  console.log('OCRリクエスト受信')
  const { imageData } = req.body
  if (!imageData) return res.status(400).json({ error: '画像データが見つかりません' })

  const apiKey = process.env.GOOGLE_VISION_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'GOOGLE_VISION_API_KEY が設定されていません' })

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30000)

    console.log(`Vision API呼び出し開始 imageData長さ=${imageData.length}`)
    let visionRes
    try {
      visionRes = await fetch(
        `https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requests: [{
              image: { content: imageData },
              features: [{ type: 'TEXT_DETECTION' }]
            }]
          }),
          signal: controller.signal,
        }
      )
    } finally {
      clearTimeout(timeoutId)
    }

    console.log(`Vision API応答 status=${visionRes.status}`)
    const visionData = await visionRes.json()
    console.log('Vision APIレスポンス:', JSON.stringify(visionData).slice(0, 300))

    if (!visionRes.ok) throw new Error(`Vision API HTTP ${visionRes.status}: ${JSON.stringify(visionData)}`)
    if (visionData.error) throw new Error(visionData.error.message)

    const fullText = visionData.responses?.[0]?.fullTextAnnotation?.text ?? ''
    console.log(`抽出テキスト長さ=${fullText.length}`)
    if (!fullText) return res.json({ date: null, amount: null, storeName: null })

    const parsed = parseReceiptText(fullText)
    const category = suggestCategory(fullText, parsed.storeName)
    res.json({ ...parsed, ...(category ? { category } : {}) })
  } catch (e) {
    console.error('OCRエラー:', e.message)
    res.status(500).json({ error: e.message })
  }
})

app.get(/.*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'))
})

const PORT = process.env.PORT || 3001
app.listen(PORT, () => console.log(`Server: http://localhost:${PORT}`))
