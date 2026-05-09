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

const headers = { 'Content-Type': 'application/json' }

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' }
  }

  try {
    const { imageData } = JSON.parse(event.body)
    if (!imageData) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: '画像データが見つかりません' }) }
    }

    const apiKey = process.env.GOOGLE_VISION_API_KEY
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'GOOGLE_VISION_API_KEY が設定されていません' }) }
    }

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
    if (!fullText) {
      return { statusCode: 200, headers, body: JSON.stringify({ date: null, amount: null, storeName: null }) }
    }

    return { statusCode: 200, headers, body: JSON.stringify(parseReceiptText(fullText)) }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
