import React, { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, CircleCheck, CircleX, Copy, ExternalLink, KeyRound, LoaderCircle, Pencil, Plus, Search, Server, Trash2, X } from 'lucide-react'

const makeId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
const blankEndpoint = () => ({ id: makeId(), name: '主 API', url: '', apiKey: '', hasKey: false, models: [] })
const blankGateway = () => ({ id: makeId(), name: '', website: '', note: '', endpoints: [blankEndpoint()] })
const hasUrl = value => /^https?:\/\//i.test(String(value || '').trim())

function ModelChips({ models = [] }) {
  const visible = models.slice(0, 10)
  if (!visible.length) return <span className="model-empty">尚未读取模型</span>
  return <div className="model-chips">{visible.map(model => <span className="model-chip" title={model} key={model}>{model}</span>)}{models.length > visible.length && <span className="model-more">+{models.length - visible.length}</span>}</div>
}

export default function AiGateways({ notify }) {
  const [gateways, setGateways] = useState([])
  const [ready, setReady] = useState(false)
  const [draft, setDraft] = useState(null)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [probing, setProbing] = useState(null)
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return gateways
    return gateways.filter(gateway => [gateway.name, gateway.website, gateway.note, ...(gateway.endpoints || []).flatMap(endpoint => [endpoint.name, endpoint.url])]
      .some(value => String(value || '').toLowerCase().includes(query)))
  }, [gateways, search])

  const reload = async () => {
    const records = await window.aiGatewayStore?.read?.() || []
    setGateways(records)
    return records
  }

  useEffect(() => { reload().catch(() => notify('无法读取 AI 中转站记录', 'error')).finally(() => setReady(true)) }, [])

  const openCreate = () => { setDraft(blankGateway()); setEditingId(null) }
  const openEdit = gateway => {
    setDraft({ ...gateway, endpoints: gateway.endpoints.map(endpoint => ({ ...endpoint, apiKey: '' })) })
    setEditingId(gateway.id)
  }
  const updateEndpoint = (id, patch) => setDraft(current => ({ ...current, endpoints: current.endpoints.map(endpoint => endpoint.id === id ? { ...endpoint, ...patch } : endpoint) }))
  const removeEndpoint = id => setDraft(current => ({ ...current, endpoints: current.endpoints.length === 1 ? current.endpoints : current.endpoints.filter(endpoint => endpoint.id !== id) }))

  const copyText = async value => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value)
      return
    }
    const area = document.createElement('textarea')
    area.value = value
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    document.execCommand('copy')
    area.remove()
  }

  const copyEndpointUrl = async endpoint => {
    try {
      if (!endpoint.url) throw new Error('没有可复制的 API 地址')
      await copyText(endpoint.url)
      notify('API 地址已复制')
    } catch (error) { notify(error.message || '复制 API 地址失败', 'error') }
  }

  const copyEndpointKey = async (gatewayId, endpointId) => {
    try {
      const copied = await window.aiGatewayStore?.copyKey?.(gatewayId, endpointId)
      if (!copied) throw new Error('没有可复制的 API Key')
      notify('API Key 已复制')
    } catch (error) { notify(error.message || '复制 API Key 失败', 'error') }
  }

  const save = async event => {
    event.preventDefault()
    if (!draft?.name.trim()) { notify('请填写中转站名称', 'error'); return }
    if (draft.website && !hasUrl(draft.website)) { notify('官网地址需要以 http:// 或 https:// 开头', 'error'); return }
    for (const endpoint of draft.endpoints) {
      if (!endpoint.name.trim() || !hasUrl(endpoint.url)) { notify('请填写每个 API 地址的名称和有效地址', 'error'); return }
      if (!endpoint.hasKey && !endpoint.apiKey.trim()) { notify(`请为「${endpoint.name}」填写 API Key`, 'error'); return }
    }
    setSaving(true)
    try {
      const next = editingId ? gateways.map(gateway => gateway.id === editingId ? draft : gateway) : [...gateways, draft]
      const saved = await window.aiGatewayStore.save(next)
      setGateways(saved)
      setDraft(null); setEditingId(null)
      notify('中转站已保存')
    } catch (error) { notify(error.message || '保存失败', 'error') } finally { setSaving(false) }
  }

  const probe = async (gatewayId, endpointId) => {
    setProbing(endpointId)
    try {
      const result = await window.aiGatewayStore.probe(gatewayId, endpointId)
      setGateways(current => current.map(gateway => gateway.id === gatewayId ? { ...gateway, endpoints: gateway.endpoints.map(endpoint => endpoint.id === endpointId ? { ...endpoint, ...result } : endpoint) } : gateway))
      notify(`读取到 ${result.modelCount} 个模型`)
    } catch (error) {
      await reload().catch(() => {})
      notify(error.message || '检测失败', 'error')
    } finally { setProbing(null) }
  }

  const removeGateway = async id => {
    try {
      const saved = await window.aiGatewayStore.save(gateways.filter(gateway => gateway.id !== id))
      setGateways(saved); notify('中转站已删除')
    } catch (error) { notify(error.message || '删除失败', 'error') }
  }

  return <main className="content ai-content">
    <section className="page-heading ai-heading"><div><h1>AI 中转</h1><p>把 API 地址、模型和访问状态放在一起。</p></div><button className="add-button" onClick={openCreate}><Plus size={16} />添加中转站</button></section>
    <div className="toolbar"><label className="search"><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索中转站或 API 地址" aria-label="搜索中转站" /></label><span className="count">{gateways.length} 个中转站</span></div>
    <div className="ai-security"><KeyRound size={15} />API Key 和配置仅保存在这台电脑；可随时一键复制使用。</div>
    {!ready && <div className="empty"><LoaderCircle className="spin-blue" size={25} /><h2>正在读取中转站</h2></div>}
    {ready && gateways.length === 0 && <div className="empty ai-empty"><Server size={26} /><h2>添加第一个中转站</h2><p>一个中转站可以保存多个 API 地址。</p><button className="empty-add-button" onClick={openCreate}><Plus size={15} />添加中转站</button></div>}
    {ready && gateways.length > 0 && visible.length === 0 && <div className="empty ai-empty"><Search size={25} /><h2>没有找到中转站</h2><p>换个名称或 API 地址试试。</p></div>}
    <section className="gateway-list">{visible.map(gateway => <article className="gateway-card" key={gateway.id}>
      <div className="gateway-head"><div className="gateway-name"><div className="gateway-mark"><Server size={17} /></div><div><h2>{gateway.name}</h2><p>{gateway.endpoints.length} 个 API 地址{gateway.note ? ` · ${gateway.note}` : ''}</p>{gateway.website && <a href={gateway.website} target="_blank" rel="noreferrer"><ExternalLink size={11} />官网</a>}</div></div><div className="gateway-actions"><button className="icon-action" aria-label={`编辑 ${gateway.name}`} title="编辑中转站" onClick={() => openEdit(gateway)}><Pencil size={15} /></button><button className="icon-action delete" aria-label={`删除 ${gateway.name}`} title="删除中转站" onClick={() => removeGateway(gateway.id)}><Trash2 size={15} /></button></div></div>
      <div className="endpoint-list">{gateway.endpoints.map(endpoint => <div className="endpoint" key={endpoint.id}>
        <div className="endpoint-title"><strong>{endpoint.name}</strong><span className={endpoint.error ? 'endpoint-state failed' : endpoint.lastCheck ? 'endpoint-state good' : 'endpoint-state'}>{endpoint.error ? <CircleX size={12} /> : endpoint.lastCheck ? <CircleCheck size={12} /> : null}{endpoint.error ? '不可用' : endpoint.lastCheck ? '可用' : '未检测'}</span><code>{endpoint.url}</code></div>
        <div className="endpoint-result"><div><span>响应</span><strong>{endpoint.latency ? `${endpoint.latency} ms` : '—'}</strong></div><div><span>模型</span><strong>{endpoint.modelCount || '—'}</strong></div><div className="endpoint-tools"><button className="copy-endpoint-button" onClick={() => copyEndpointUrl(endpoint)}><Copy size={13} />复制地址</button><button className="copy-endpoint-button" onClick={() => copyEndpointKey(gateway.id, endpoint.id)}><KeyRound size={13} />复制 Key</button><button className="probe-button" disabled={probing === endpoint.id} onClick={() => probe(gateway.id, endpoint.id)}>{probing === endpoint.id ? <><LoaderCircle className="spin" size={14} />检测中</> : '检测并读取模型'}</button></div></div>
        {endpoint.error && <div className="endpoint-error"><AlertCircle size={13} />{endpoint.error}</div>}
        <ModelChips models={endpoint.models} />
      </div>)}</div>
    </article>)}</section>
    {draft && <div className="sheet-backdrop" onMouseDown={() => !saving && setDraft(null)}><form className="sheet ai-sheet" onSubmit={save} onMouseDown={event => event.stopPropagation()}>
      <div className="sheet-header"><div><p>{editingId ? '修改站点与地址' : '本地保存 Key'}</p><h2>{editingId ? '编辑中转站' : '添加中转站'}</h2></div><button type="button" className="close-button" disabled={saving} onClick={() => setDraft(null)}><X size={17} /></button></div>
      <div className="gateway-form-grid">
        <label>中转站名称<input autoFocus value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} placeholder="例如：我的 OpenAI 中转" /></label>
        <label>官网地址 <small>选填</small><input type="url" value={draft.website} onChange={event => setDraft({ ...draft, website: event.target.value })} placeholder="https://…" /></label>
        <label className="gateway-note-field">备注 <small>选填</small><input value={draft.note} onChange={event => setDraft({ ...draft, note: event.target.value })} placeholder="例如：主力、备用或特定地区" /></label>
      </div>
      <div className="endpoint-editor-head"><span><i>连接设置</i>API 地址</span><button type="button" onClick={() => setDraft({ ...draft, endpoints: [...draft.endpoints, { ...blankEndpoint(), name: `API 地址 ${draft.endpoints.length + 1}` }] })}><Plus size={14} />添加地址</button></div>
      <div className="endpoint-editor-list">{draft.endpoints.map((endpoint, index) => <div className="endpoint-editor" key={endpoint.id}>
        <div className="endpoint-editor-top"><span>API 地址 {index + 1}</span><button type="button" className="mini-delete" aria-label={`删除 API 地址 ${index + 1}`} title="删除此地址" disabled={draft.endpoints.length === 1} onClick={() => removeEndpoint(endpoint.id)}><Trash2 size={14} /></button></div>
        <div className="endpoint-editor-grid">
          <label className="endpoint-name-field">名称<input value={endpoint.name} onChange={event => updateEndpoint(endpoint.id, { name: event.target.value })} placeholder={`API 地址 ${index + 1}`} /></label>
          <label>Base URL<input type="url" value={endpoint.url} onChange={event => updateEndpoint(endpoint.id, { url: event.target.value })} placeholder="https://api.example.com/v1" /></label>
          <label className="endpoint-key-field">API Key <small>{endpoint.hasKey ? '已保存；留空不修改' : '直接保存在本机'}</small><input type="password" value={endpoint.apiKey || ''} onChange={event => updateEndpoint(endpoint.id, { apiKey: event.target.value })} placeholder={endpoint.hasKey ? '••••••••••••' : 'sk-…'} autoComplete="off" /></label>
        </div>
      </div>)}</div>
      <div className="sheet-actions"><button type="button" className="cancel-button" disabled={saving} onClick={() => setDraft(null)}>取消</button><button type="submit" className="save-button" disabled={saving}>{saving ? <><LoaderCircle className="spin" size={14} />保存中</> : <><Check size={15} />保存</>}</button></div>
    </form></div>}
  </main>
}
