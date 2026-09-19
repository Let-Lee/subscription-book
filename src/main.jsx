import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Activity, AlertCircle, Check, Copy, ExternalLink, Link2, Pencil, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import AiGateways from './AiGateways'
import Domains from './Domains'
import Servers from './Servers'
import appIcon from '../assets/icon-master.png'
import './theme.css'

const legacyStorageKey = 'nexus-simple-items'
// 当天零点。此前这里写死为 new Date('2026-09-05')，导致到期倒计时每天都在漂
const today = new Date(new Date().toDateString())
const formatBytes = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(bytes >= 100 * 1024 ** 3 ? 0 : 1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}
const formatDate = (date) => new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).format(date)
const expiryFromSeconds = (seconds) => seconds ? new Date(seconds * 1000) : null

function getExpiry(item) {
  if (item.expiryMode === 'lifetime') return { title: '永久有效', detail: '手动标记', isSoon: false }
  const date = item.expiryMode === 'date' && item.manualExpire ? new Date(`${item.manualExpire}T00:00:00`) : expiryFromSeconds(item.expire)
  if (!date || Number.isNaN(date.getTime())) return { title: '未提供', detail: '服务端未返回到期时间', isSoon: false }
  const remaining = Math.ceil((date.getTime() - today.getTime()) / 86400000)
  return { title: formatDate(date), detail: remaining < 0 ? '已到期' : `${remaining} 天后`, isSoon: remaining <= 14 }
}

function App() {
  const [items, setItems] = useState([])
  const [activePage, setActivePage] = useState('subscriptions')
  const [ready, setReady] = useState(false)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(null)
  const [refreshing, setRefreshing] = useState(null)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState(null)
  const [link, setLink] = useState('')
  const [editForm, setEditForm] = useState(null)

  const notify = (message, tone = 'success') => { setNotice({ message, tone }); window.setTimeout(() => setNotice(null), tone === 'error' ? 9000 : 3000) }
  const displayName = (item) => item.manualName?.trim() || item.name || '未命名订阅'
  const displayWebsite = (item) => item.manualWebsite?.trim() || item.website || ''

  useEffect(() => {
    const load = async () => {
      try {
        const saved = window.subscriptionStore ? await window.subscriptionStore.read() : null
        if (Array.isArray(saved)) setItems(saved)
        else {
          const legacy = JSON.parse(localStorage.getItem(legacyStorageKey) || '[]')
          setItems(Array.isArray(legacy) ? legacy : [])
        }
      } catch { setItems([]) } finally { setReady(true) }
    }
    load()
  }, [])

  useEffect(() => {
    if (!ready) return
    if (window.subscriptionStore) window.subscriptionStore.save(items).catch(() => notify('保存失败，请重试', 'error'))
    else localStorage.setItem(legacyStorageKey, JSON.stringify(items))
  }, [items, ready])

  const visible = useMemo(() => items.filter(item => `${displayName(item)} ${item.note || ''}`.toLowerCase().includes(search.trim().toLowerCase())), [items, search])
  const copy = async (item) => {
    try {
      if (!item.link) throw new Error('missing')
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(item.link)
      else throw new Error('clipboard')
    } catch {
      const area = document.createElement('textarea')
      area.value = item.link || ''
      area.style.position = 'fixed'; area.style.opacity = '0'
      document.body.appendChild(area); area.select(); document.execCommand('copy'); area.remove()
    }
    notify('订阅链接已复制')
  }
  const refresh = async (item) => {
    if (!window.subscriptionStore?.refresh) { notify('请在 Mac 应用中刷新订阅信息', 'error'); return }
    setRefreshing(item.id)
    try {
      const details = await window.subscriptionStore.refresh(item.link)
      setItems(list => list.map(record => record.id === item.id ? { ...record, ...details } : record))
      notify(details.hasUsageInfo ? '订阅信息已更新' : '链接可用，但服务端未返回流量信息', details.hasUsageInfo ? 'success' : 'error')
    } catch (error) { notify(error.message || '读取订阅信息失败', 'error') } finally { setRefreshing(null) }
  }
  const add = async (event) => {
    event.preventDefault()
    const cleanedLink = link.trim()
    if (!/^https?:\/\//i.test(cleanedLink)) { notify('请粘贴有效的订阅链接', 'error'); return }
    if (!window.subscriptionStore?.refresh) { notify('请在 Mac 应用中添加订阅', 'error'); return }
    setAdding(true)
    try {
      const details = await window.subscriptionStore.refresh(cleanedLink)
      setItems(list => [...list, { id: Date.now(), link: cleanedLink, ...details }])
      setLink(''); setShowAdd(false)
      notify(details.hasUsageInfo ? '已自动读取订阅信息' : '链接已添加，但服务端未返回流量信息', details.hasUsageInfo ? 'success' : 'error')
    } catch (error) { notify(error.message || '无法读取这个订阅链接', 'error') } finally { setAdding(false) }
  }
  const openEdit = (item) => {
    setEditing(item.id)
    setEditForm({ link: item.link || '', manualName: item.manualName || '', manualWebsite: item.manualWebsite || '', expiryMode: item.expiryMode || 'auto', manualExpire: item.manualExpire || '', note: item.note || '' })
  }
  const saveEdit = (event) => {
    event.preventDefault()
    if (!editForm) return
    if (!/^https?:\/\//i.test(editForm.link.trim())) { notify('请填写有效的订阅链接', 'error'); return }
    if (editForm.expiryMode === 'date' && !editForm.manualExpire) { notify('请选择手动到期日期', 'error'); return }
    setItems(list => list.map(item => item.id === editing ? { ...item, ...editForm, link: editForm.link.trim() } : item))
    setEditing(null); setEditForm(null); notify('修改已保存')
  }
  const remove = (id) => { setItems(list => list.filter(item => item.id !== id)); notify('订阅已删除') }

  return <div className="app">
    <header className="window-header"><div className="brand"><div className="brand-icon"><img src={appIcon} alt="" /></div><span>订阅簿</span></div><nav className="page-tabs" aria-label="页面"><button className={activePage === 'subscriptions' ? 'active' : ''} aria-current={activePage === 'subscriptions' ? 'page' : undefined} onClick={() => setActivePage('subscriptions')}>订阅</button><button className={activePage === 'ai' ? 'active' : ''} aria-current={activePage === 'ai' ? 'page' : undefined} onClick={() => setActivePage('ai')}>AI 中转</button><button className={activePage === 'domains' ? 'active' : ''} aria-current={activePage === 'domains' ? 'page' : undefined} onClick={() => setActivePage('domains')}>域名</button><button className={activePage === 'servers' ? 'active' : ''} aria-current={activePage === 'servers' ? 'page' : undefined} onClick={() => setActivePage('servers')}>云服务器</button></nav><div className="header-spacer" aria-hidden="true" /></header>
    {activePage === 'subscriptions' && <main className="content">
      <section className="page-heading subscription-heading"><div><h1>订阅</h1><p>粘贴链接，流量和到期信息会自动读取。</p></div><button className="add-button" onClick={() => setShowAdd(true)}><Plus size={16} />添加链接</button></section>
      <div className="toolbar"><div className="search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索订阅" /></div><span className="count">{items.length} 个订阅</span></div>
      {ready && visible.length > 0 && <section className="subscription-list" aria-label="订阅列表">{visible.map(item => {
        const percentage = item.totalBytes ? Math.min(100, Math.round((item.usedBytes || 0) / item.totalBytes * 100)) : 0
        const expiry = getExpiry(item)
        const website = displayWebsite(item)
        return <article className="subscription" key={item.id}>
          <div className="subscription-icon"><Link2 size={18} /></div>
          <div className="subscription-name"><div className="title-line"><h2>{displayName(item)}</h2></div><p><Link2 size={11} />链接已保存 <span>·</span> 上次更新 {item.refreshedAt ? new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(item.refreshedAt)) : '—'}</p>{website && <a className="website-link" href={website} target="_blank" rel="noreferrer"><ExternalLink size={11} />官网</a>}{item.note && <span className="note-line">{item.note}</span>}</div>
          <div className="subscription-usage"><span className="label">流量</span><strong>{item.totalBytes ? `${formatBytes(item.usedBytes || 0)} / ${formatBytes(item.totalBytes)}` : '服务端未提供'}</strong><div className="progress"><i className={percentage >= 85 ? 'high' : ''} style={{ width: `${percentage}%` }} /></div></div>
          <div className="subscription-expiry"><span className="label">到期</span><strong className={expiry.isSoon ? 'soon' : ''}>{expiry.title}</strong><small className={expiry.isSoon ? 'soon' : ''}>{expiry.detail}</small></div>
          <div className="subscription-speed"><span className="label">剩余流量</span><strong>{item.totalBytes ? formatBytes(Math.max(0, item.totalBytes - (item.usedBytes || 0))) : '—'}</strong><small>{item.updateInterval ? `建议 ${item.updateInterval} 小时更新` : '点击刷新读取最新信息'}</small></div>
          <div className="actions"><button className="test-button" onClick={() => refresh(item)} disabled={refreshing === item.id}>{refreshing === item.id ? <><span className="spinner" />读取中</> : <><RefreshCw size={15} />刷新</>}</button><button className="icon-action" title="编辑订阅" aria-label={`编辑 ${displayName(item)}`} onClick={() => openEdit(item)}><Pencil size={15} /></button><button className="icon-action" title="复制订阅链接" aria-label={`复制 ${displayName(item)} 的订阅链接`} onClick={() => copy(item)}><Copy size={16} /></button><button className="icon-action delete" title="删除订阅" aria-label={`删除 ${displayName(item)}`} onClick={() => remove(item.id)}><Trash2 size={16} /></button></div>
        </article>
      })}</section>}
      {!ready && <div className="empty"><Activity size={25} /><h2>正在读取本地数据</h2></div>}
      {ready && visible.length === 0 && <div className="empty"><Link2 size={25} /><h2>{search ? '没有找到订阅' : '添加第一个订阅链接'}</h2><p>{search ? '换个关键词，或添加一个新的订阅。' : '无需填写流量、到期日或套餐类型。'}</p>{!search && <button className="empty-add-button" onClick={() => setShowAdd(true)}><Plus size={15} />粘贴订阅链接</button>}</div>}
      <p className="privacy-note"><ShieldCheck size={15} />纯本地模式，订阅链接不会离开你的设备。</p>
    </main>}
    {activePage === 'ai' && <AiGateways notify={notify} />}
    {activePage === 'domains' && <Domains notify={notify} />}
    {activePage === 'servers' && <Servers notify={notify} />}
    {showAdd && <div className="sheet-backdrop" onMouseDown={() => !adding && setShowAdd(false)}><form className="sheet" onSubmit={add} onMouseDown={event => event.stopPropagation()}><div className="sheet-header"><div><p>自动识别</p><h2>添加订阅链接</h2></div><button type="button" className="close-button" disabled={adding} onClick={() => setShowAdd(false)} aria-label="关闭"><X size={17} /></button></div><label>订阅链接 <small>会自动读取流量、到期日和订阅名称</small><input type="url" required autoFocus value={link} onChange={event => setLink(event.target.value)} placeholder="https://…" /></label><div className="sheet-actions"><button type="button" className="cancel-button" disabled={adding} onClick={() => setShowAdd(false)}>取消</button><button type="submit" className="save-button" disabled={adding}>{adding ? <><span className="spinner" />读取中</> : <><Check size={15} />添加并读取</>}</button></div></form></div>}
    {editing && editForm && <div className="sheet-backdrop" onMouseDown={() => setEditing(null)}><form className="sheet edit-sheet" onSubmit={saveEdit} onMouseDown={event => event.stopPropagation()}><div className="sheet-header"><div><p>手动覆盖自动读取数据</p><h2>编辑订阅</h2></div><button type="button" className="close-button" onClick={() => setEditing(null)} aria-label="关闭"><X size={17} /></button></div><label>显示名称 <small>留空则使用服务端名称</small><input value={editForm.manualName} onChange={event => setEditForm({ ...editForm, manualName: event.target.value })} placeholder="例如：主力机场" /></label><label>订阅链接<input type="url" required value={editForm.link} onChange={event => setEditForm({ ...editForm, link: event.target.value })} /></label><label>官网地址 <small>留空则使用服务端返回的官网</small><input type="url" value={editForm.manualWebsite} onChange={event => setEditForm({ ...editForm, manualWebsite: event.target.value })} placeholder="https://…" /></label><div className="form-grid"><label>到期状态<select value={editForm.expiryMode} onChange={event => setEditForm({ ...editForm, expiryMode: event.target.value })}><option value="auto">服务端自动读取</option><option value="lifetime">永久有效</option><option value="date">手动设置日期</option></select></label>{editForm.expiryMode === 'date' && <label>到期日期<input type="date" value={editForm.manualExpire} onChange={event => setEditForm({ ...editForm, manualExpire: event.target.value })} /></label>}</div><label>备注<input value={editForm.note} onChange={event => setEditForm({ ...editForm, note: event.target.value })} placeholder="例如：备用、仅出差时使用" /></label><div className="sheet-actions"><button type="button" className="cancel-button" onClick={() => setEditing(null)}>取消</button><button type="submit" className="save-button"><Check size={15} />保存修改</button></div></form></div>}
    {notice && <div className={`toast ${notice.tone}`}><>{notice.tone === 'error' ? <AlertCircle size={15} /> : <Check size={15} />}</>{notice.message}</div>}
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
