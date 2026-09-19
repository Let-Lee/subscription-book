import React, { useEffect, useMemo, useState } from 'react'
import { CalendarDays, Check, ChevronDown, ExternalLink, Globe2, LoaderCircle, Pencil, Plus, RefreshCw, Search, Server, Trash2, X } from 'lucide-react'
import './domains.css'

const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
const blankDomain = () => ({ id: makeId(), domain: '', registrar: '', expiryDate: '', rdapExpiryDate: '', autoRenew: false, dnsProvider: '', nameservers: [], managementUrl: '', note: '', serverIds: [], lookupAt: '' })
const validWebUrl = value => { try { return ['https:', 'http:'].includes(new URL(value).protocol) } catch { return false } }
const normaliseDomain = value => String(value || '').trim().toLowerCase().replace(/\.$/, '')
const readableError = (error, fallback) => String(error?.message || '')
  .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
  .replace(/^(?:Error:\s*)+/i, '')
  .trim() || fallback
const validDomain = value => {
  if (!value || /[\s\/?#@:\\]/.test(value)) return false
  try {
    const ascii = new URL(`http://${value}`).hostname
    const labels = ascii.split('.')
    return ascii.length <= 253 && labels.length >= 2 && labels.every(label => label.length >= 1 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
  } catch { return false }
}

function expiryInfo(record) {
  const raw = record.expiryDate || record.rdapExpiryDate
  if (!raw) return { text: '未获取', hint: '可手动填写', state: 'unknown', sort: Infinity }
  const date = new Date(`${String(raw).slice(0, 10)}T00:00:00`)
  if (Number.isNaN(date.getTime())) return { text: '未获取', hint: '日期无效', state: 'unknown', sort: Infinity }
  const start = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const now = new Date()
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const days = Math.round((start - today) / 86400000)
  return {
    text: `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`,
    hint: days < 0 ? '已到期' : days === 0 ? '今天到期' : `${days} 天后`,
    state: days < 0 ? 'expired' : days <= 30 ? 'soon' : 'normal',
    sort: start,
  }
}

export default function Domains({ notify }) {
  const [records, setRecords] = useState([])
  const [servers, setServers] = useState([])
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [lookingUp, setLookingUp] = useState(false)
  const [lookupNotice, setLookupNotice] = useState('')
  const [showMore, setShowMore] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(null)

  const reload = async () => {
    if (!window.domainStore?.read) throw new Error('当前应用版本缺少域名管理功能')
    const [domains, cloudServers] = await Promise.all([
      window.domainStore.read(),
      window.serverStore?.read?.() || Promise.resolve([]),
    ])
    setRecords(Array.isArray(domains) ? domains : [])
    setServers(Array.isArray(cloudServers) ? cloudServers : [])
    setLoadError('')
  }

  useEffect(() => {
    reload().catch(error => setLoadError(readableError(error, '无法读取域名记录'))).finally(() => setReady(true))
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return records.filter(item => !needle || [item.domain, item.registrar, item.dnsProvider, item.note].some(value => String(value || '').toLowerCase().includes(needle)))
      .sort((a, b) => expiryInfo(a).sort - expiryInfo(b).sort || String(a.domain).localeCompare(String(b.domain), 'zh-CN'))
  }, [records, query])

  const openCreate = () => { setEditingId(null); setDraft(blankDomain()); setLookupNotice(''); setShowMore(false) }
  const openEdit = item => { setEditingId(item.id); setDraft({ ...blankDomain(), ...item, nameservers: [...(item.nameservers || [])], serverIds: [...(item.serverIds || [])] }); setLookupNotice(''); setShowMore(false) }
  const update = patch => setDraft(current => ({ ...current, ...patch }))

  const lookup = async () => {
    const domain = normaliseDomain(draft?.domain)
    if (!validDomain(domain)) { setLookupNotice('请先填写有效的域名，例如 example.com'); return }
    if (!window.domainStore?.lookup) { setLookupNotice('当前应用版本不支持公开信息查询'); return }
    setLookingUp(true); setLookupNotice('')
    try {
      const result = await window.domainStore.lookup(domain)
      setDraft(current => ({
        ...current,
        registrar: current.registrar?.trim() ? current.registrar : (result.registrar || ''),
        rdapExpiryDate: result.rdapExpiryDate || '',
        nameservers: current.nameservers?.length ? current.nameservers : (result.nameservers || []),
        lookupAt: result.lookupAt || new Date().toISOString(),
      }))
      const source = typeof result.source === 'string' && result.source.trim() ? result.source.trim() : '公开查询服务'
      setLookupNotice(result.rdapExpiryDate ? `已从 ${source} 读取公开信息；手填到期日仍优先显示。` : `已从 ${source} 读取公开信息，但未提供到期日，可手动填写。`)
    } catch (error) { setLookupNotice(`${readableError(error, '公开信息查询失败')}；仍可手动填写并保存。`) }
    finally { setLookingUp(false) }
  }

  const save = async event => {
    event.preventDefault()
    const domain = normaliseDomain(draft?.domain)
    if (!validDomain(domain)) { notify('请填写有效的域名，例如 example.com', 'error'); return }
    if (records.some(item => item.id !== editingId && normaliseDomain(item.domain) === domain)) { notify('这个域名已经在清单中', 'error'); return }
    if (draft.managementUrl && !validWebUrl(draft.managementUrl)) { notify('管理后台地址需要以 http:// 或 https:// 开头', 'error'); return }
    if (draft.expiryDate && Number.isNaN(new Date(`${draft.expiryDate}T00:00:00`).getTime())) { notify('到期日期无效', 'error'); return }
    setSaving(true)
    try {
      const clean = { ...draft, domain, registrar: draft.registrar.trim(), dnsProvider: draft.dnsProvider.trim(), managementUrl: draft.managementUrl.trim(), note: draft.note.trim(), nameservers: draft.nameservers.map(value => value.trim()).filter(Boolean), serverIds: [...new Set(draft.serverIds)] }
      const next = editingId ? records.map(item => item.id === editingId ? clean : item) : [...records, clean]
      const saved = await window.domainStore.save(next)
      setRecords(saved); setDraft(null); setEditingId(null)
      notify('域名已保存')
    } catch (error) { notify(readableError(error, '保存域名失败'), 'error') }
    finally { setSaving(false) }
  }

  const remove = async () => {
    if (!pendingDelete) return
    setSaving(true)
    try {
      const saved = await window.domainStore.save(records.filter(item => item.id !== pendingDelete.id))
      setRecords(saved); setPendingDelete(null); notify('域名已删除')
    } catch (error) { notify(readableError(error, '删除域名失败'), 'error') }
    finally { setSaving(false) }
  }

  const toggleServer = id => update({ serverIds: draft.serverIds.includes(id) ? draft.serverIds.filter(value => value !== id) : [...draft.serverIds, id] })

  return <main className="content domains-content">
    <section className="page-heading domain-page-heading"><div><h1>域名</h1><p>到期日期和托管位置，一眼就能找到。</p></div><button className="add-button" onClick={openCreate}><Plus size={15} />添加域名</button></section>
    <div className="domain-toolbar"><label className="domain-search"><Search size={15} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索域名、注册商或备注" aria-label="搜索域名" /></label><span>{records.length} 个域名 · 按到期时间排序</span></div>
    {!ready && <div className="domain-empty"><LoaderCircle className="domain-spin" size={23} /><strong>正在读取域名</strong></div>}
    {ready && loadError && <div className="domain-empty"><Globe2 size={24} /><strong>域名记录无法读取</strong><p>{loadError}</p><button onClick={() => reload().catch(error => setLoadError(readableError(error, '读取失败')))}>重试</button></div>}
    {ready && !loadError && !records.length && <div className="domain-empty"><Globe2 size={27} /><strong>还没有域名</strong><p>添加后可查看到期时间，并关联到云服务器。</p><button onClick={openCreate}><Plus size={14} />添加域名</button></div>}
    {ready && !loadError && records.length > 0 && !visible.length && <div className="domain-empty"><Search size={23} /><strong>没有找到匹配的域名</strong><p>试试其他关键词。</p></div>}
    {visible.length > 0 && <section className="domain-list" aria-label="域名列表">{visible.map(item => {
      const expiry = expiryInfo(item)
      const linked = (item.serverIds || []).map(id => servers.find(server => server.id === id)).filter(Boolean)
      return <article className="domain-row" key={item.id}>
        <div className="domain-identity"><div className="domain-mark"><Globe2 size={17} /></div><div className="domain-identity-text"><h2>{item.domain}</h2><span>{item.registrar || '未填写注册商'}{item.dnsProvider ? ` · DNS ${item.dnsProvider}` : ''}</span></div></div>
        <div className={`domain-expiry domain-expiry-${expiry.state}`}><small>到期时间</small><strong>{expiry.text}</strong><span>{expiry.hint}{item.autoRenew ? ' · 自动续费' : ''}</span></div>
        <div className="domain-linked"><small>关联服务器</small><strong>{linked.length ? linked.map(server => server.name || server.label || server.publicIp || '未命名服务器').join('、') : '未关联'}</strong></div>
        <div className="domain-actions">{validWebUrl(item.managementUrl) && <a href={item.managementUrl} target="_blank" rel="noreferrer" title="打开管理后台" aria-label={`打开 ${item.domain} 的管理后台`}><ExternalLink size={15} /></a>}<button onClick={() => openEdit(item)} title="编辑域名" aria-label={`编辑 ${item.domain}`}><Pencil size={15} /></button><button className="domain-delete" onClick={() => setPendingDelete(item)} title="删除域名" aria-label={`删除 ${item.domain}`}><Trash2 size={15} /></button></div>
      </article>
    })}</section>}

    {draft && <div className="sheet-backdrop domain-backdrop" onMouseDown={() => !saving && !lookingUp && setDraft(null)}><form className="domain-sheet" onSubmit={save} onMouseDown={event => event.stopPropagation()}>
      <div className="domain-sheet-header"><div><span>域名档案</span><h2>{editingId ? '编辑域名' : '添加域名'}</h2></div><button type="button" onClick={() => setDraft(null)} disabled={saving || lookingUp} aria-label="关闭"><X size={17} /></button></div>
      <div className="domain-sheet-body">
        <div className="domain-field"><label htmlFor="domain-name">域名</label><div className="domain-lookup-row"><input id="domain-name" autoFocus value={draft.domain} onChange={event => { update({ domain: event.target.value }); setLookupNotice('') }} placeholder="example.com" spellCheck="false" autoCapitalize="off" /><button type="button" onClick={lookup} disabled={lookingUp || !draft.domain.trim()}>{lookingUp ? <LoaderCircle className="domain-spin" size={14} /> : <RefreshCw size={14} />}查询公开信息</button></div>{lookupNotice && <p className="domain-lookup-message">{lookupNotice}</p>}</div>
        <div className="domain-form-grid">
          <div className="domain-field"><label htmlFor="domain-registrar">注册商</label><input id="domain-registrar" value={draft.registrar} onChange={event => update({ registrar: event.target.value })} placeholder="例如 Cloudflare" /></div>
          <div className="domain-field"><label htmlFor="domain-expiry">到期日期 <em>手填优先</em></label><input id="domain-expiry" type="date" value={draft.expiryDate || ''} onChange={event => update({ expiryDate: event.target.value })} /></div>
          <div className="domain-field"><label htmlFor="domain-dns">DNS 服务商</label><input id="domain-dns" value={draft.dnsProvider} onChange={event => update({ dnsProvider: event.target.value })} placeholder="例如 Cloudflare" /></div>
          <label className="domain-renew"><input type="checkbox" checked={!!draft.autoRenew} onChange={event => update({ autoRenew: event.target.checked })} /><span><strong>自动续费</strong><small>仅作记录，不会执行续费</small></span></label>
          <div className="domain-field domain-wide"><label htmlFor="domain-manager">管理后台地址</label><input id="domain-manager" type="url" value={draft.managementUrl} onChange={event => update({ managementUrl: event.target.value })} placeholder="https://…" /></div>
        </div>
        {draft.rdapExpiryDate && <p className="domain-rdap-note"><CalendarDays size={13} />公开资料到期日：{String(draft.rdapExpiryDate).slice(0, 10)}{draft.expiryDate ? ' · 当前显示手填日期' : ''}</p>}
        <div className="domain-form-section"><div><strong>关联云服务器</strong><span>可选择多台</span></div>{servers.length ? <div className="domain-server-options">{servers.map(server => <label key={server.id} className={draft.serverIds.includes(server.id) ? 'selected' : ''}><input type="checkbox" checked={draft.serverIds.includes(server.id)} onChange={() => toggleServer(server.id)} /><Server size={14} /><span>{server.name || server.label || server.publicIp || '未命名服务器'}</span></label>)}</div> : <p>还没有云服务器，稍后可以再关联。</p>}</div>
        <div className="domain-field domain-note"><label htmlFor="domain-note">备注</label><textarea id="domain-note" rows="2" value={draft.note} onChange={event => update({ note: event.target.value })} placeholder="选填" /></div>
        <div className="domain-more"><button type="button" aria-expanded={showMore} aria-controls={showMore ? 'domain-more-fields' : undefined} onClick={() => setShowMore(value => !value)}>更多信息 <span>{draft.nameservers?.filter(Boolean).length ? `${draft.nameservers.filter(Boolean).length} 条 Name Server` : 'Name Server'}</span><ChevronDown size={14} className={showMore ? 'expanded' : ''} /></button>{showMore && <div id="domain-more-fields" className="domain-field"><label htmlFor="domain-ns">Name Server <em>每行一个</em></label><textarea id="domain-ns" rows="2" value={(draft.nameservers || []).join('\n')} onChange={event => update({ nameservers: event.target.value.split('\n') })} placeholder="例如 ns1.example.com" spellCheck="false" /></div>}</div>
      </div>
      <div className="domain-sheet-actions"><button type="button" onClick={() => setDraft(null)} disabled={saving}>取消</button><button type="submit" disabled={saving || lookingUp}>{saving ? <><LoaderCircle className="domain-spin" size={14} />保存中</> : <><Check size={15} />保存域名</>}</button></div>
    </form></div>}

    {pendingDelete && <div className="sheet-backdrop domain-backdrop" onMouseDown={() => !saving && setPendingDelete(null)}><div className="domain-confirm" role="alertdialog" aria-modal="true" aria-labelledby="domain-confirm-title" onMouseDown={event => event.stopPropagation()}><h2 id="domain-confirm-title">删除这个域名？</h2><p>「{pendingDelete.domain}」将从本地清单移除。</p><div><button onClick={() => setPendingDelete(null)} disabled={saving}>取消</button><button onClick={remove} disabled={saving}>{saving ? '删除中' : '删除域名'}</button></div></div></div>}
  </main>
}
