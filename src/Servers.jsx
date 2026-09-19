import React, { useEffect, useMemo, useState } from 'react'
import { Activity, Check, CircleHelp, ExternalLink, Globe2, HardDrive, LoaderCircle, Pencil, Plus, Search, Server, Trash2, X } from 'lucide-react'
import './servers.css'

const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
const emptyServer = () => ({
  id: makeId(), name: '', provider: '', region: '', instanceId: '', publicIp: '',
  cpu: '', memory: '', disk: '', billingMode: 'prepaid', expiryDate: '',
  consoleUrl: '', sshUser: 'root', sshPort: '22', websiteUrl: '', note: '',
  tcpResult: null, httpResult: null,
})
const websitePattern = /^https?:\/\/\S+$/i
const errorText = (error, fallback) => (error?.message || fallback).replace(/^Error invoking remote method ['"][^'"]+['"]:\s*(?:Error:\s*)?/, '')
const dateValue = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null
}
const dateText = value => {
  const date = dateValue(value)
  return date ? new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(date) : ''
}
const dueInfo = server => {
  if (server.billingMode === 'postpaid') return { label: '按量付费', detail: '无固定到期日', tone: 'neutral', rank: Infinity }
  const date = dateValue(server.expiryDate)
  if (!date) return { label: '未填写', detail: '到期日', tone: 'muted', rank: Infinity }
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const days = Math.round((date.getTime() - today.getTime()) / 86400000)
  return {
    label: dateText(server.expiryDate),
    detail: days < 0 ? `已过期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `${days} 天后到期`,
    tone: days < 0 ? 'danger' : days <= 30 ? 'warning' : 'neutral',
    rank: date.getTime(),
  }
}
const checkTime = value => {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date)
}

function CheckResult({ title, result, kind }) {
  const status = result?.status || 'idle'
  let headline = '未检测'
  if (status === 'not-configured') headline = '未配置'
  else if (status === 'error') headline = '连接失败'
  else if (status === 'ok' && kind === 'http' && result.httpStatus) headline = `HTTP ${result.httpStatus}`
  else if (status === 'ok') headline = '连接正常'
  const secondary = result?.message || (kind === 'tcp' ? '检测公网 IP 与 SSH 端口' : '检测网站地址')
  return <div className={`server-check server-check-${status}`}>
    <div className="server-check-top"><span>{title}</span><strong>{headline}</strong></div>
    <p title={secondary}>{secondary}</p>
    <div className="server-check-foot">
      <span>{Number.isFinite(result?.latencyMs) ? `${Math.round(result.latencyMs)} ms` : '—'}</span>
      <time>{checkTime(result?.checkedAt) || '尚无检测时间'}</time>
    </div>
  </div>
}

function ServerForm({ draft, setDraft, onSave, onClose, saving, editing }) {
  const [formPage, setFormPage] = useState('basic')
  const pages = [{ id: 'basic', label: '基本信息' }, { id: 'billing', label: '计费续费' }, { id: 'connection', label: '连接与备注' }]
  const update = (key, value) => setDraft(current => ({ ...current, [key]: value }))
  const handleSubmit = event => {
    event.preventDefault()
    if (!draft.name.trim()) setFormPage('basic')
    else if (draft.consoleUrl && !websitePattern.test(draft.consoleUrl.trim())) setFormPage('billing')
    else if ((draft.websiteUrl && !websitePattern.test(draft.websiteUrl.trim())) || (draft.sshPort && (!Number.isInteger(Number(draft.sshPort)) || Number(draft.sshPort) < 1 || Number(draft.sshPort) > 65535))) setFormPage('connection')
    onSave(event)
  }
  const handleTabKeys = event => {
    const index = pages.findIndex(page => page.id === formPage)
    const next = event.key === 'ArrowRight' ? (index + 1) % pages.length : event.key === 'ArrowLeft' ? (index + pages.length - 1) % pages.length : event.key === 'Home' ? 0 : event.key === 'End' ? pages.length - 1 : -1
    if (next === -1) return
    event.preventDefault()
    setFormPage(pages[next].id)
    event.currentTarget.querySelectorAll('button')[next]?.focus()
  }
  return <div className="sheet-backdrop" onMouseDown={() => { if (!saving) onClose() }}>
    <form className="sheet server-sheet" onMouseDown={event => event.stopPropagation()} onSubmit={handleSubmit} noValidate>
      <div className="sheet-header server-sheet-header"><div><p>云服务器</p><h2>{editing ? '编辑服务器' : '添加服务器'}</h2></div><button type="button" className="close-button" aria-label="关闭" disabled={saving} onClick={onClose}><X size={17} /></button></div>
      <nav className="server-form-tabs" aria-label="编辑服务器信息" onKeyDown={handleTabKeys}>{pages.map(page => <button type="button" key={page.id} aria-pressed={formPage === page.id} className={formPage === page.id ? 'active' : ''} onClick={() => setFormPage(page.id)}>{page.label}</button>)}</nav>
      <div className="server-sheet-body">
        {formPage === 'basic' && <div className="server-form-section"><div className="server-form-grid">
          <label className="server-col-2"><span className="server-field-label">名称 <small>必填</small></span><input autoFocus required value={draft.name} onChange={event => update('name', event.target.value)} placeholder="例如：东京主服务器" /></label>
          <label>厂商<input value={draft.provider} onChange={event => update('provider', event.target.value)} placeholder="例如：阿里云" /></label>
          <label>区域<input value={draft.region} onChange={event => update('region', event.target.value)} placeholder="例如：东京" /></label>
          <label>实例 ID<input value={draft.instanceId} onChange={event => update('instanceId', event.target.value)} placeholder="选填" /></label>
          <label>公网 IP<input value={draft.publicIp} onChange={event => update('publicIp', event.target.value)} placeholder="IPv4 或 IPv6" spellCheck={false} /></label>
          <label>CPU<input value={draft.cpu} onChange={event => update('cpu', event.target.value)} placeholder="例如：2 核" /></label>
          <label>内存<input value={draft.memory} onChange={event => update('memory', event.target.value)} placeholder="例如：4 GB" /></label>
          <label className="server-col-2">磁盘<input value={draft.disk} onChange={event => update('disk', event.target.value)} placeholder="例如：50 GB SSD" /></label>
        </div></div>}
        {formPage === 'billing' && <div className="server-form-section"><div className="server-form-grid">
          <label>计费方式<select value={draft.billingMode} onChange={event => setDraft(current => ({ ...current, billingMode: event.target.value, expiryDate: event.target.value === 'postpaid' ? '' : current.expiryDate }))}><option value="prepaid">包月 / 包年</option><option value="postpaid">按量付费</option></select></label>
          <label><span className="server-field-label">到期日 <small>{draft.billingMode === 'postpaid' ? '按量付费无需填写' : '选填'}</small></span><input type="date" value={draft.expiryDate} disabled={draft.billingMode === 'postpaid'} onChange={event => update('expiryDate', event.target.value)} /></label>
          <label className="server-col-2">控制台地址<input type="url" value={draft.consoleUrl} onChange={event => update('consoleUrl', event.target.value)} placeholder="https://…" /></label>
        </div></div>}
        {formPage === 'connection' && <div className="server-form-section server-form-last"><div className="server-section-title">检测从这台电脑发起</div><div className="server-form-grid">
          <label>SSH 用户名<input value={draft.sshUser} onChange={event => update('sshUser', event.target.value)} placeholder="例如：root" /></label>
          <label>SSH 端口<input type="number" inputMode="numeric" min="1" max="65535" value={draft.sshPort ?? ''} onChange={event => update('sshPort', event.target.value)} placeholder="22" /></label>
          <label className="server-col-2">网站检测地址<input type="url" value={draft.websiteUrl} onChange={event => update('websiteUrl', event.target.value)} placeholder="https://example.com" /></label>
        </div><div className="server-note-field"><label htmlFor="server-note">备注</label><textarea id="server-note" value={draft.note} onChange={event => update('note', event.target.value)} placeholder="用途、续费提醒或其他信息" rows="2" /></div></div>}
      </div>
      <div className="sheet-actions server-sheet-actions"><button type="button" className="cancel-button" disabled={saving} onClick={onClose}>取消</button><button type="submit" className="save-button" disabled={saving}>{saving ? <><LoaderCircle className="server-spin" size={14} />保存中</> : <><Check size={15} />保存</>}</button></div>
    </form>
  </div>
}

export default function Servers({ notify }) {
  const [servers, setServers] = useState([])
  const [domains, setDomains] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [probingId, setProbingId] = useState(null)

  useEffect(() => {
    let active = true
    Promise.allSettled([window.serverStore.read(), window.domainStore.read()]).then(([serverResult, domainResult]) => {
      if (!active) return
      if (serverResult.status === 'rejected') throw serverResult.reason
      setServers(Array.isArray(serverResult.value) ? serverResult.value : [])
      setDomains(domainResult.status === 'fulfilled' && Array.isArray(domainResult.value) ? domainResult.value : [])
      if (domainResult.status === 'rejected') notify('服务器已读取，但关联域名暂时无法显示', 'error')
      setError('')
    }).catch(err => { if (active) setError(errorText(err, '无法读取服务器记录')) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])

  const visible = useMemo(() => {
    const term = search.trim().toLocaleLowerCase()
    return servers.filter(server => {
      if (!term) return true
      const linked = domains.filter(domain => domain.serverIds?.includes(String(server.id))).map(domain => domain.domain || domain.name || '')
      return [server.name, server.provider, server.region, server.instanceId, server.publicIp, ...linked].some(value => String(value || '').toLocaleLowerCase().includes(term))
    }).sort((a, b) => dueInfo(a).rank - dueInfo(b).rank || String(a.name).localeCompare(String(b.name), 'zh-CN'))
  }, [servers, domains, search])

  const openCreate = () => { setEditingId(null); setDraft(emptyServer()) }
  const openEdit = server => { setEditingId(server.id); setDraft({ ...server }) }
  const closeForm = () => { setDraft(null); setEditingId(null) }
  const save = async event => {
    event.preventDefault()
    if (!draft) return
    if (!draft.name.trim()) { notify('请填写服务器名称', 'error'); return }
    if (draft.consoleUrl && !websitePattern.test(draft.consoleUrl.trim())) { notify('控制台地址需要以 http:// 或 https:// 开头', 'error'); return }
    if (draft.websiteUrl && !websitePattern.test(draft.websiteUrl.trim())) { notify('网站检测地址需要以 http:// 或 https:// 开头', 'error'); return }
    if (draft.sshPort && (!Number.isInteger(Number(draft.sshPort)) || Number(draft.sshPort) < 1 || Number(draft.sshPort) > 65535)) { notify('SSH 端口应为 1–65535', 'error'); return }
    setSaving(true)
    try {
      const clean = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]))
      const next = editingId ? servers.map(server => server.id === editingId ? clean : server) : [...servers, clean]
      const saved = await window.serverStore.save(next)
      setServers(saved)
      closeForm()
      notify('服务器已保存')
    } catch (err) { notify(errorText(err, '保存服务器失败'), 'error') } finally { setSaving(false) }
  }
  const remove = async () => {
    if (!pendingDelete) return
    setDeleting(true)
    try {
      const saved = await window.serverStore.save(servers.filter(item => item.id !== pendingDelete.id))
      setServers(saved)
      setPendingDelete(null)
      notify('服务器已删除')
    } catch (err) { notify(errorText(err, '删除服务器失败'), 'error') } finally { setDeleting(false) }
  }
  const probe = async server => {
    setProbingId(server.id)
    try {
      const result = await window.serverStore.probe(server.id)
      setServers(current => current.map(item => item.id === server.id ? { ...item, tcpResult: result.tcpResult, httpResult: result.httpResult } : item))
      const parts = [result.tcpResult, result.httpResult]
      if (parts.every(item => item?.status === 'not-configured')) notify('请先填写公网 IP 与 SSH 端口，或填写网站检测地址', 'error')
      else if (parts.some(item => item?.status === 'error')) notify('检测完成，请查看连接结果', 'error')
      else if (parts.some(item => item?.status === 'not-configured')) notify('检测完成；未配置的项目已标出')
      else notify('检测完成')
    } catch (err) { notify(errorText(err, '检测失败'), 'error') } finally { setProbingId(null) }
  }

  return <main className="content servers-content">
    <section className="page-heading server-heading"><div><h1>云服务器</h1><p>实例、到期时间与连接状态，放在同一处。</p></div><button className="add-button" onClick={openCreate}><Plus size={16} />添加服务器</button></section>
    <div className="toolbar server-toolbar"><label className="search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称、IP 或域名" aria-label="搜索服务器" /></label><span className="count">{servers.length} 台服务器</span></div>
    {loading && <div className="empty server-empty"><LoaderCircle className="server-spin" size={25} /><h2>正在读取服务器</h2></div>}
    {!loading && error && <div className="empty server-empty"><CircleHelp size={25} /><h2>服务器记录读取失败</h2><p>{error}</p></div>}
    {!loading && !error && servers.length === 0 && <div className="empty server-empty"><Server size={27} /><h2>添加第一台服务器</h2><p>保存实例信息，之后可以一键检测连接。</p><button className="empty-add-button" onClick={openCreate}><Plus size={15} />添加服务器</button></div>}
    {!loading && !error && servers.length > 0 && visible.length === 0 && <div className="empty server-empty"><Search size={25} /><h2>没有匹配的服务器</h2><p>换个名称、IP 或域名试试。</p></div>}
    <section className="server-list" aria-label="服务器列表">{visible.map(server => {
      const due = dueInfo(server)
      const linkedDomains = domains.filter(domain => domain.serverIds?.includes(String(server.id)))
      return <article className="server-card" key={server.id}>
        <div className="server-card-head">
          <div className="server-identity"><span className="server-mark"><HardDrive size={16} /></span><div className="server-identity-text"><h2>{server.name}</h2><p>{[server.provider, server.region, server.publicIp].filter(Boolean).join(' · ') || '还未填写厂商、区域或 IP'}</p></div></div>
          <div className="server-card-actions"><button className="server-icon-button" aria-label={`编辑 ${server.name}`} title="编辑服务器" onClick={() => openEdit(server)}><Pencil size={15} /></button><button className="server-icon-button server-remove" aria-label={`删除 ${server.name}`} title="删除服务器" onClick={() => setPendingDelete(server)}><Trash2 size={15} /></button></div>
        </div>
        <div className="server-card-meta"><div className="server-due"><span className="server-meta-label">到期</span><strong className={`server-due-${due.tone}`}>{due.label}</strong><small>{due.detail}</small></div><div className="server-spec"><span className="server-meta-label">配置</span><strong>{[server.cpu, server.memory, server.disk].filter(Boolean).join(' · ') || '未填写'}</strong><small>{server.instanceId || '无实例 ID'}</small></div></div>
        {(linkedDomains.length > 0 || server.consoleUrl || server.note) && <div className="server-card-extras">{linkedDomains.length > 0 && <div className="server-domains"><Globe2 size={12} />{linkedDomains.map(domain => <span key={domain.id}>{domain.domain || domain.name}</span>)}</div>}{server.consoleUrl && websitePattern.test(server.consoleUrl) && <a href={server.consoleUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} />控制台</a>}{server.note && <span className="server-note" title={server.note}>{server.note}</span>}</div>}
        <div className="server-connectivity"><CheckResult title="IP · 端口" result={server.tcpResult} kind="tcp" /><CheckResult title="网站" result={server.httpResult} kind="http" /><button className="server-probe-button" disabled={probingId === server.id} onClick={() => probe(server)}>{probingId === server.id ? <><LoaderCircle className="server-spin" size={14} />检测中</> : <><Activity size={14} />检测连接</>}</button></div>
      </article>
    })}</section>
    {draft && <ServerForm draft={draft} setDraft={setDraft} onSave={save} onClose={closeForm} saving={saving} editing={Boolean(editingId)} />}
    {pendingDelete && <div className="sheet-backdrop" onMouseDown={() => { if (!deleting) setPendingDelete(null) }}><div className="server-confirm" role="alertdialog" aria-modal="true" aria-labelledby="server-confirm-title" onMouseDown={event => event.stopPropagation()}><h2 id="server-confirm-title">删除这台服务器？</h2><p>「{pendingDelete.name}」将从本地清单移除。</p><div><button onClick={() => setPendingDelete(null)} disabled={deleting}>取消</button><button onClick={remove} disabled={deleting}>{deleting ? '删除中' : '删除服务器'}</button></div></div></div>}
  </main>
}
