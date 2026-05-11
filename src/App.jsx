import { useState, useRef } from 'react'
import './App.css'

// ── カテゴリ定義 ─────────────────────────────────────────────
const EXPENSE_CATEGORY_MAP = {
  'ビジネス用': ['セミナー費', 'コンサル費', '交通費', '通信費', '接待費', '消耗品', 'その他'],
  '個人用':     ['食費', '日用品', '医療費', '交通費', 'その他'],
}
const EXPENSE_MAIN = Object.keys(EXPENSE_CATEGORY_MAP)
const INCOME_CATEGORIES = ['コンサル料', 'セミナー収入', 'ボランティア謝礼', 'その他収入']
const PAYMENT_METHODS = ['現金', '郵貯銀行', '三井住友銀行', '楽天銀行', '楽天カード', 'PayPay']

const emptyForm = {
  type: 'expense',
  date: '', amount: '',
  mainCategory: 'ビジネス用', subCategory: 'セミナー費',
  incomeCategory: 'コンサル料',
  payment: '現金',
  recipient: '', note: '',
}

let nextId = 1

function formatAmount(n) {
  return `¥${Number(n).toLocaleString('ja-JP')}`
}

// ── バッジ ────────────────────────────────────────────────────
const EXPENSE_MAIN_COLOR = {
  'ビジネス用': { bg: '#eff6ff', color: '#2563eb' },
  '個人用':     { bg: '#f0fdf4', color: '#16a34a' },
}

function CategoryBadge({ type, mainCategory, subCategory, incomeCategory }) {
  if (type === 'income') {
    return <span className="badge badge-income">{incomeCategory}</span>
  }
  const s = EXPENSE_MAIN_COLOR[mainCategory] ?? { bg: '#f3f4f6', color: '#555' }
  return (
    <span className="badge" style={{ background: s.bg, color: s.color }}>
      {mainCategory} / {subCategory}
    </span>
  )
}

function TypeBadge({ type }) {
  return type === 'income'
    ? <span className="badge badge-type-income">収入</span>
    : <span className="badge badge-type-expense">支出</span>
}

function PaymentBadge({ method }) {
  return <span className="badge badge-payment">{method}</span>
}

// ── OCR セクション ────────────────────────────────────────────
function OcrSection({ onExtract }) {
  const [preview, setPreview] = useState(null)
  const [status, setStatus] = useState(null) // null | 'loading' | 'ok' | 'error'
  const [msg, setMsg] = useState('')
  const cameraRef = useRef(null)
  const fileRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = ev => setPreview(ev.target.result)
    reader.readAsDataURL(file)

    setStatus('loading')
    setMsg('AIが読み取り中...')

    try {
      const base64 = await new Promise((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(r.result.split(',')[1])
        r.onerror = reject
        r.readAsDataURL(file)
      })
      const res = await fetch('/api/analyze-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: base64, mediaType: 'image/jpeg' }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      onExtract(data)
      const found = [data.date && '日付', data.amount && '金額', data.storeName && '店名', data.category && 'カテゴリ'].filter(Boolean)
      setStatus('ok')
      setMsg(found.length ? `${found.join('・')}を読み取りました` : '読み取れませんでした（手動入力してください）')
    } catch (err) {
      setStatus('error')
      setMsg(`読み取り失敗: ${err.message}`)
    } finally {
      e.target.value = ''
    }
  }

  return (
    <div className="ocr-section">
      <div className="ocr-header">
        <span className="ocr-title">📷 AI自動読み取り</span>
        <span className="ocr-hint">レシート・領収書の写真をアップロードすると自動入力します</span>
      </div>
      <div className="ocr-body">
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={handleFile} />
        <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleFile} />
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-ocr"
            onClick={() => cameraRef.current.click()}
            disabled={status === 'loading'}
          >
            {status === 'loading' ? '読み取り中...' : '📷 カメラで撮影'}
          </button>
          <button
            type="button"
            className="btn btn-ocr"
            onClick={() => fileRef.current.click()}
            disabled={status === 'loading'}
          >
            📁 ファイルを選択
          </button>
        </div>

        {preview && (
          <div className="ocr-preview-wrap">
            <img src={preview} alt="preview" className="ocr-preview" />
          </div>
        )}

        {status && (
          <div className={`ocr-msg ocr-msg-${status}`}>
            {status === 'loading' && <span className="ocr-spinner" />}
            {msg}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 入力フォーム ──────────────────────────────────────────────
function ReceiptForm({ onAdd }) {
  const [form, setForm] = useState(emptyForm)

  function handleChange(e) {
    const { name, value } = e.target
    if (name === 'mainCategory') {
      setForm(f => ({ ...f, mainCategory: value, subCategory: EXPENSE_CATEGORY_MAP[value][0] }))
    } else if (name === 'type') {
      setForm(f => ({ ...f, type: value }))
    } else {
      setForm(f => ({ ...f, [name]: value }))
    }
  }

  function handleOcrExtract(data) {
    setForm(f => ({
      ...f,
      date:      data.date      ?? f.date,
      amount:    data.amount    != null ? String(data.amount) : f.amount,
      recipient: data.storeName ?? f.recipient,
      ...(data.category ? {
        mainCategory: data.category.main,
        subCategory:  data.category.sub,
      } : {}),
    }))
  }

  function handleSubmit(e) {
    e.preventDefault()
    if (!form.date || !form.amount || !form.recipient) return
    onAdd({ ...form, id: nextId++, amount: Number(form.amount) })
    setForm(emptyForm)
  }

  const isIncome = form.type === 'income'

  return (
    <div className="form-card">
      <h2>領収書を追加</h2>

      <OcrSection onExtract={handleOcrExtract} />

      {/* 収入 / 支出 トグル */}
      <div className="type-toggle">
        <label className={`type-option ${!isIncome ? 'active-expense' : ''}`}>
          <input type="radio" name="type" value="expense" checked={!isIncome} onChange={handleChange} />
          支出
        </label>
        <label className={`type-option ${isIncome ? 'active-income' : ''}`}>
          <input type="radio" name="type" value="income" checked={isIncome} onChange={handleChange} />
          収入
        </label>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="form-grid-3">
          <div className="form-group">
            <label>日付 *</label>
            <input type="date" name="date" value={form.date} onChange={handleChange} required />
          </div>
          <div className="form-group">
            <label>金額 (円) *</label>
            <input type="number" name="amount" value={form.amount} onChange={handleChange} placeholder="0" min="0" required />
          </div>
          <div className="form-group">
            <label>支払い方法</label>
            <select name="payment" value={form.payment} onChange={handleChange}>
              {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
            </select>
          </div>
        </div>

        <div className="form-grid-3">
          {isIncome ? (
            <div className="form-group">
              <label>収入カテゴリ</label>
              <select name="incomeCategory" value={form.incomeCategory} onChange={handleChange}>
                {INCOME_CATEGORIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          ) : (
            <>
              <div className="form-group">
                <label>大分類</label>
                <select name="mainCategory" value={form.mainCategory} onChange={handleChange}>
                  {EXPENSE_MAIN.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>小カテゴリ</label>
                <select name="subCategory" value={form.subCategory} onChange={handleChange}>
                  {EXPENSE_CATEGORY_MAP[form.mainCategory].map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
            </>
          )}
          <div className="form-group">
            <label>宛名 / 店名 *</label>
            <input type="text" name="recipient" value={form.recipient} onChange={handleChange} placeholder="例: 株式会社○○" required />
          </div>
        </div>

        <div className="form-grid-1">
          <div className="form-group">
            <label>但し書き / 備考</label>
            <input type="text" name="note" value={form.note} onChange={handleChange} placeholder="例: 会議費として" />
          </div>
        </div>

        <div className="form-actions">
          <button className={`btn ${isIncome ? 'btn-income' : 'btn-primary'}`} type="submit">
            {isIncome ? '収入を追加' : '支出を追加'}
          </button>
        </div>
      </form>
    </div>
  )
}

// ── テーブル行 ────────────────────────────────────────────────
function ReceiptRow({ receipt, onDelete, onUpdate }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(receipt)

  function handleDraftChange(e) {
    const { name, value } = e.target
    if (name === 'mainCategory') {
      setDraft(d => ({ ...d, mainCategory: value, subCategory: EXPENSE_CATEGORY_MAP[value][0] }))
    } else {
      setDraft(d => ({ ...d, [name]: value }))
    }
  }

  function save() {
    onUpdate({ ...draft, amount: Number(draft.amount) })
    setEditing(false)
  }

  const isIncome = editing ? draft.type === 'income' : receipt.type === 'income'

  if (editing) {
    return (
      <tr>
        <td>
          <select className="edit-input" name="type" value={draft.type} onChange={handleDraftChange}>
            <option value="expense">支出</option>
            <option value="income">収入</option>
          </select>
        </td>
        <td><input className="edit-input" type="date" name="date" value={draft.date} onChange={handleDraftChange} /></td>
        <td><input className="edit-input" type="number" name="amount" value={draft.amount} onChange={handleDraftChange} /></td>
        <td>
          <select className="edit-input" name="payment" value={draft.payment} onChange={handleDraftChange}>
            {PAYMENT_METHODS.map(m => <option key={m}>{m}</option>)}
          </select>
        </td>
        <td>
          {isIncome ? (
            <select className="edit-input" name="incomeCategory" value={draft.incomeCategory} onChange={handleDraftChange}>
              {INCOME_CATEGORIES.map(c => <option key={c}>{c}</option>)}
            </select>
          ) : (
            <div style={{ display: 'flex', gap: '4px' }}>
              <select className="edit-input" name="mainCategory" value={draft.mainCategory} onChange={handleDraftChange}>
                {EXPENSE_MAIN.map(c => <option key={c}>{c}</option>)}
              </select>
              <select className="edit-input" name="subCategory" value={draft.subCategory} onChange={handleDraftChange}>
                {EXPENSE_CATEGORY_MAP[draft.mainCategory].map(c => <option key={c}>{c}</option>)}
              </select>
            </div>
          )}
        </td>
        <td><input className="edit-input" name="recipient" value={draft.recipient} onChange={handleDraftChange} /></td>
        <td><input className="edit-input" name="note" value={draft.note} onChange={handleDraftChange} /></td>
        <td className="actions-cell">
          <button className="btn btn-success" onClick={save}>保存</button>
          <button className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '12px' }} onClick={() => { setDraft(receipt); setEditing(false) }}>キャンセル</button>
        </td>
      </tr>
    )
  }

  return (
    <tr>
      <td><TypeBadge type={receipt.type} /></td>
      <td>{receipt.date}</td>
      <td className={receipt.type === 'income' ? 'amount-cell-income' : 'amount-cell'}>
        {receipt.type === 'income' ? '+' : '-'}{formatAmount(receipt.amount)}
      </td>
      <td><PaymentBadge method={receipt.payment} /></td>
      <td><CategoryBadge {...receipt} /></td>
      <td>{receipt.recipient}</td>
      <td style={{ color: '#888' }}>{receipt.note}</td>
      <td className="actions-cell">
        <button className="btn btn-warning" onClick={() => setEditing(true)}>編集</button>
        <button className="btn btn-danger" onClick={() => onDelete(receipt.id)}>削除</button>
      </td>
    </tr>
  )
}

// ── 月次集計 ──────────────────────────────────────────────────
function buildMonthlyStats(receipts) {
  const map = {}
  for (const r of receipts) {
    const month = r.date.slice(0, 7)
    if (!map[month]) map[month] = { income: 0, expense: 0 }
    if (r.type === 'income') map[month].income += r.amount
    else map[month].expense += r.amount
  }
  return Object.entries(map).sort((a, b) => b[0].localeCompare(a[0]))
}

function MonthlyStats({ receipts }) {
  const stats = buildMonthlyStats(receipts)
  if (stats.length === 0) return null

  return (
    <div className="monthly-card">
      <h2 className="monthly-title">月次集計</h2>
      <table className="monthly-table">
        <thead>
          <tr>
            <th style={{ textAlign: 'left' }}>月</th>
            <th style={{ color: '#16a34a' }}>収入</th>
            <th style={{ color: '#ef4444' }}>支出</th>
            <th>収支</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(([month, s]) => {
            const net = s.income - s.expense
            return (
              <tr key={month}>
                <td className="month-label">{month.replace('-', '年')}月</td>
                <td className="month-income">{s.income > 0 ? formatAmount(s.income) : <span className="zero">—</span>}</td>
                <td className="month-expense">{s.expense > 0 ? formatAmount(s.expense) : <span className="zero">—</span>}</td>
                <td className={net >= 0 ? 'month-net-plus' : 'month-net-minus'}>{net >= 0 ? '+' : ''}{formatAmount(net)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── CSV出力 ───────────────────────────────────────────────────
function csvQuote(v) {
  const s = String(v ?? '')
  return `"${s.replace(/"/g, '""')}"`
}

function exportCSV(receipts) {
  const header = ['区分', '日付', '金額', '支払い方法', '大分類', 'カテゴリ', '宛名', '但し書き']
  const rows = receipts.map(r => [
    r.type === 'income' ? '収入' : '支出',
    r.date,
    r.type === 'income' ? r.amount : -r.amount,
    r.payment,
    r.type === 'income' ? '収入' : r.mainCategory,
    r.type === 'income' ? r.incomeCategory : r.subCategory,
    r.recipient,
    r.note,
  ])
  const csv = [header, ...rows].map(r => r.map(csvQuote).join(',')).join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `receipts_${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ── メイン ────────────────────────────────────────────────────
export default function App() {
  const [receipts, setReceipts] = useState([])

  const totalIncome  = receipts.filter(r => r.type === 'income').reduce((s, r) => s + r.amount, 0)
  const totalExpense = receipts.filter(r => r.type === 'expense').reduce((s, r) => s + r.amount, 0)
  const net = totalIncome - totalExpense

  function addReceipt(r)       { setReceipts(prev => [r, ...prev]) }
  function deleteReceipt(id)   { setReceipts(prev => prev.filter(r => r.id !== id)) }
  function updateReceipt(upd)  { setReceipts(prev => prev.map(r => r.id === upd.id ? upd : r)) }

  return (
    <>
      <div className="app-header">
        <h1>領収書管理</h1>
        <span style={{ fontSize: '13px', opacity: 0.8 }}>Receipt Manager</span>
      </div>

      <div className="summary-bar">
        <div className="summary-item">
          <span className="summary-label">件数</span>
          <span className="summary-value">{receipts.length} 件</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-item">
          <span className="summary-label">収入合計</span>
          <span className="summary-value" style={{ color: '#16a34a' }}>{formatAmount(totalIncome)}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">支出合計</span>
          <span className="summary-value" style={{ color: '#ef4444' }}>{formatAmount(totalExpense)}</span>
        </div>
        <div className="summary-divider" />
        <div className="summary-item">
          <span className="summary-label">収支</span>
          <span className="summary-value" style={{ color: net >= 0 ? '#16a34a' : '#ef4444' }}>
            {net >= 0 ? '+' : ''}{formatAmount(net)}
          </span>
        </div>
      </div>

      <ReceiptForm onAdd={addReceipt} />

      <MonthlyStats receipts={receipts} />

      <div className="toolbar">
        <h2>登録済み領収書 ({receipts.length}件)</h2>
        <button className="btn btn-success" onClick={() => exportCSV(receipts)} disabled={receipts.length === 0}>
          CSV 出力
        </button>
      </div>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>区分</th>
              <th>日付</th>
              <th>金額</th>
              <th>支払い方法</th>
              <th>カテゴリ</th>
              <th>宛名</th>
              <th>但し書き</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {receipts.length === 0 ? (
              <tr><td colSpan={8} className="empty-state">まだ領収書がありません。上のフォームから追加してください。</td></tr>
            ) : (
              receipts.map(r => (
                <ReceiptRow key={r.id} receipt={r} onDelete={deleteReceipt} onUpdate={updateReceipt} />
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
