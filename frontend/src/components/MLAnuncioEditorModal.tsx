import { useEffect, useMemo, useState, type CSSProperties } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

type Mode = 'descricao' | 'flex' | 'atacado' | 'imagens' | 'ficha' | 'dimensoes'

interface AnuncioBase {
  id: string
  titulo: string
  sku: string
  preco: number
  permalink?: string
  imagem_principal?: string
  thumbnail?: string
  flex?: boolean
}

interface AttributeRow {
  id: string
  name: string
  value_id?: string | null
  value_name?: string | null
  value_type?: string
}

interface PictureRow {
  id?: string
  url: string
}

interface DetailPayload {
  item: AnuncioBase & {
    tipo_anuncio?: string
    tipo_anuncio_id?: string
    categoria_id?: string
    frete_custo?: number | null
    frete_gratis?: boolean
    logistica?: string
    full?: boolean
    dimensoes?: { texto?: string | null } | null
  }
  description?: { plain_text?: string }
  attributes: AttributeRow[]
  pictures: PictureRow[]
  prices: Array<{ id: string; type: string; amount: number; regular_amount?: number | null; currency_id?: string }>
  sale_price?: { amount?: number; regular_amount?: number | null }
  shipping_fee?: { list_cost?: number; currency_id?: string; billable_weight?: number; free_shipping_by_meli?: boolean }
  shipping_preview?: { list_cost?: number; cost?: number; shipping_method_type?: string }
  shipping_tags?: string[]
  tags?: string[]
  sale_terms?: Array<{ id: string; name: string; value_name?: string | null }>
  tarifa_atual?: { percentual?: number; fixo?: number; tarifa?: number }
  zip_code_usado?: string | null
}

interface Props {
  anuncio: AnuncioBase
  mode: Mode
  onClose: () => void
  onUpdated: () => void
}

const brl = (v?: number | null) => v == null ? '--' : 'R$ ' + Number(v).toFixed(2).replace('.', ',')

function getAttr(attributes: AttributeRow[], id: string) {
  return attributes.find(a => a.id === id)?.value_name || ''
}

export function MLAnuncioEditorModal({ anuncio, mode, onClose, onUpdated }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [detail, setDetail] = useState<DetailPayload | null>(null)
  const [descricao, setDescricao] = useState('')
  const [pictures, setPictures] = useState<PictureRow[]>([])
  const [newFiles, setNewFiles] = useState<File[]>([])
  const [attrs, setAttrs] = useState<Record<string, string>>({})
  const [dimensoes, setDimensoes] = useState({ largura: '', altura: '', comprimento: '', peso: '', packageType: 'Com embalagem adicional' })

  useEffect(() => {
    let active = true
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}`, { cache: 'no-store' })
        const d = await r.json()
        if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao carregar anúncio')
        if (!active) return
        setDetail(d)
        setDescricao(d.description?.plain_text || '')
        setPictures(d.pictures || [])
        const attrMap: Record<string, string> = {}
        for (const attr of d.attributes || []) attrMap[attr.id] = attr.value_name || ''
        setAttrs(attrMap)
        setDimensoes({
          largura: getAttr(d.attributes || [], 'SELLER_PACKAGE_WIDTH').replace(' cm', ''),
          altura: getAttr(d.attributes || [], 'SELLER_PACKAGE_HEIGHT').replace(' cm', ''),
          comprimento: getAttr(d.attributes || [], 'SELLER_PACKAGE_LENGTH').replace(' cm', ''),
          peso: getAttr(d.attributes || [], 'SELLER_PACKAGE_WEIGHT').replace(' g', ''),
          packageType: getAttr(d.attributes || [], 'SELLER_PACKAGE_TYPE') || 'Com embalagem adicional',
        })
      } catch (e) {
        if (active) setError(String(e))
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [anuncio.id])

  const attrRows = useMemo(() => (detail?.attributes || []).filter(a => !a.id.startsWith('SELLER_PACKAGE_')), [detail])
  const atacadoAtivo = useMemo(() => Boolean(detail?.tags?.includes('standard_price_by_quantity')), [detail])
  const flexAtivo = useMemo(() => Boolean(detail?.item?.flex), [detail])

  const submitDescricao = async () => {
    setSaving(true)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plain_text: descricao }),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao salvar descrição')
      onUpdated()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const submitFicha = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = attrRows.map(attr => ({ id: attr.id, value_name: attrs[attr.id] ?? '' }))
      const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/attributes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attributes: payload }),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao salvar ficha técnica')
      onUpdated()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const submitDimensoes = async () => {
    setSaving(true)
    setError('')
    try {
      const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/dimensions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          largura_cm: dimensoes.largura,
          altura_cm: dimensoes.altura,
          comprimento_cm: dimensoes.comprimento,
          peso_g: dimensoes.peso,
          package_type: dimensoes.packageType,
        }),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao salvar dimensões')
      onUpdated()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const submitImagens = async () => {
    setSaving(true)
    setError('')
    try {
      if (newFiles.length > 0) {
        const fd = new FormData()
        fd.append('existing_ids', JSON.stringify(pictures.map(p => p.id).filter(Boolean)))
        for (const file of newFiles) fd.append('files', file)
        const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/pictures/upload`, { method: 'POST', body: fd })
        const d = await r.json()
        if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao subir imagens')
      } else {
        const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/pictures`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pictures }),
        })
        const d = await r.json()
        if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao atualizar imagens')
      }
      onUpdated()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

  const title = {
    descricao: 'Editar Descrição do Anúncio',
    flex: 'Mercado Envios Flex',
    atacado: 'Preços de Atacado',
    imagens: 'Gerenciar Imagens do Anúncio',
    ficha: 'Ficha Técnica do Anúncio',
    dimensoes: 'Dimensões do Anúncio',
  }[mode]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(8,12,22,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 4000, padding: '1rem' }} onClick={onClose}>
      <div style={{ width: 'min(1100px, 96vw)', maxHeight: '92vh', overflow: 'auto', background: '#fff', borderRadius: '20px', boxShadow: '0 30px 80px rgba(17,24,39,.28)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem 1.25rem', borderBottom: '1px solid #eef2f6' }}>
          <h3 style={{ margin: 0, fontSize: '1.4rem', color: '#1c2741' }}>{title}</h3>
          <button onClick={onClose} style={{ width: 36, height: 36, borderRadius: 999, border: '1px solid #d7ddec', background: '#fff', cursor: 'pointer' }}>x</button>
        </div>

        {loading ? <div style={{ padding: '2rem', color: '#667085' }}>Carregando...</div> : error && !detail ? <div style={{ padding: '2rem', color: '#b42318' }}>{error}</div> : detail && (
          <div style={{ padding: '1.25rem' }}>
            <Resumo detail={detail} />
            {error && <div style={{ margin: '0 0 1rem 0', color: '#b42318' }}>{error}</div>}
            {mode === 'descricao' && (
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)} style={{ width: '100%', minHeight: 340, border: '2px solid #d6dcf5', borderRadius: 12, padding: '1rem', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: '.98rem' }} />
            )}
            {mode === 'imagens' && (
              <div>
                <label style={{ display: 'inline-block', marginBottom: '1rem', padding: '.7rem 1rem', borderRadius: 10, background: '#5d3f98', color: '#fff', cursor: 'pointer', fontWeight: 700 }}>
                  + Carregar Imagens
                  <input type="file" multiple accept="image/*" style={{ display: 'none' }} onChange={e => setNewFiles(Array.from(e.target.files || []))} />
                </label>
                {newFiles.length > 0 && <div style={{ marginBottom: '1rem', color: '#6941c6' }}>{newFiles.length} nova(s) imagem(ns) selecionada(s)</div>}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: '1rem' }}>
                  {pictures.map((pic, index) => (
                    <div key={pic.id || pic.url} style={{ border: '1px solid #d8dff0', borderRadius: 12, padding: '.5rem', background: '#fbfcff' }}>
                      <img src={pic.url} alt="" style={{ width: '100%', height: 110, objectFit: 'cover', borderRadius: 8 }} />
                      <div style={{ display: 'flex', gap: '.35rem', marginTop: '.5rem' }}>
                        <button onClick={() => setPictures(prev => prev.filter((_, i) => i !== index))} style={miniBtn('#fee4e2', '#b42318')}>Excluir</button>
                        <button disabled={index === 0} onClick={() => setPictures(prev => swap(prev, index, index - 1))} style={miniBtn('#eef2ff', '#4338ca')}>↑</button>
                        <button disabled={index === pictures.length - 1} onClick={() => setPictures(prev => swap(prev, index, index + 1))} style={miniBtn('#eef2ff', '#4338ca')}>↓</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {mode === 'ficha' && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
                {attrRows.map(attr => (
                  <label key={attr.id} style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', fontSize: '.88rem', color: '#475467' }}>
                    {attr.name}
                    <input value={attrs[attr.id] ?? ''} onChange={e => setAttrs(prev => ({ ...prev, [attr.id]: e.target.value }))} style={{ border: '1px solid #d0d7e6', borderRadius: 10, padding: '.75rem .85rem' }} />
                  </label>
                ))}
              </div>
            )}
            {mode === 'dimensoes' && (
              <div style={{ border: '1px solid #e5eaf3', borderRadius: 16, padding: '1rem' }}>
                <p style={{ marginTop: 0, color: '#475467' }}>Insira as dimensões corretas para melhorar o cálculo real do frete.</p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
                  <DimInput label="Largura (cm)" value={dimensoes.largura} onChange={v => setDimensoes(prev => ({ ...prev, largura: v }))} />
                  <DimInput label="Altura (cm)" value={dimensoes.altura} onChange={v => setDimensoes(prev => ({ ...prev, altura: v }))} />
                  <DimInput label="Comprimento (cm)" value={dimensoes.comprimento} onChange={v => setDimensoes(prev => ({ ...prev, comprimento: v }))} />
                  <DimInput label="Peso (g)" value={dimensoes.peso} onChange={v => setDimensoes(prev => ({ ...prev, peso: v }))} />
                </div>
                <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap' }}>
                  <RadioChip checked={dimensoes.packageType === 'Com embalagem adicional'} onClick={() => setDimensoes(prev => ({ ...prev, packageType: 'Com embalagem adicional' }))} label="Usar embalagem própria" />
                  <RadioChip checked={dimensoes.packageType !== 'Com embalagem adicional'} onClick={() => setDimensoes(prev => ({ ...prev, packageType: 'Sem embalagem adicional' }))} label="Usar embalagem do fabricante" />
                </div>
              </div>
            )}
            {mode === 'flex' && (
              <InfoPanel
                title={flexAtivo ? 'Flex ativo neste anúncio' : 'Flex não detectado neste anúncio'}
                lines={[
                  `Logística atual: ${detail.item.logistica || '--'}`,
                  `Tags de shipping: ${(detail.shipping_tags || []).join(', ') || '--'}`,
                  'Observação: o toggle direto de Flex não está exposto pela API pública do Mercado Livre do mesmo jeito que descrição/imagens/atributos.',
                ]}
                link={detail.item.permalink}
                linkLabel="Abrir anúncio no Mercado Livre"
              />
            )}
            {mode === 'atacado' && (
              <InfoPanel
                title={atacadoAtivo ? 'Preço por quantidade detectado' : 'Preço por quantidade não detectado'}
                lines={[
                  `Tag do anúncio: ${atacadoAtivo ? 'standard_price_by_quantity' : '--'}`,
                  `Preço atual: ${brl(detail.sale_price?.amount || detail.item.preco)}`,
                  `Preço base: ${brl(detail.sale_price?.regular_amount || detail.item.preco)}`,
                  'A API pública retornou o status/tags e os preços atuais, mas não um endpoint estável de edição de atacado neste ambiente.',
                ]}
                link={detail.item.permalink}
                linkLabel="Abrir anúncio no Mercado Livre"
              />
            )}

            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '.75rem', flexWrap: 'wrap' }}>
              <button onClick={onClose} style={secondaryBtn}>Fechar</button>
              {mode === 'descricao' && <button onClick={submitDescricao} disabled={saving} style={primaryBtn}>{saving ? 'Salvando...' : 'Salvar'}</button>}
              {mode === 'imagens' && <button onClick={submitImagens} disabled={saving} style={primaryBtn}>{saving ? 'Salvando...' : 'Salvar'}</button>}
              {mode === 'ficha' && <button onClick={submitFicha} disabled={saving} style={primaryBtn}>{saving ? 'Salvando...' : 'Salvar'}</button>}
              {mode === 'dimensoes' && <button onClick={submitDimensoes} disabled={saving} style={primaryBtn}>{saving ? 'Salvando...' : 'Salvar'}</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Resumo({ detail }: { detail: DetailPayload }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #eef2f6', flexWrap: 'wrap' }}>
      <img src={detail.item.imagem_principal || detail.item.thumbnail || ''} alt="" style={{ width: 58, height: 58, objectFit: 'cover', borderRadius: 10, border: '1px solid #dde3ef' }} />
      <div style={{ flex: 1, minWidth: 260 }}>
        <div style={{ fontWeight: 700, color: '#1d2939' }}>{detail.item.titulo}</div>
        <div style={{ color: '#667085', fontSize: '.92rem' }}>SKU: {detail.item.sku || '--'} | {detail.item.id} | Preço atual: {brl(detail.sale_price?.amount || detail.item.preco)}</div>
      </div>
      <div style={{ display: 'flex', gap: '.65rem', flexWrap: 'wrap' }}>
        <Metric label="Tarifa do produto" value={brl(detail.tarifa_atual?.tarifa)} detail={detail.tarifa_atual?.percentual ? `${detail.tarifa_atual.percentual}%` : 'sem cálculo'} />
        <Metric label="Taxa de frete" value={brl(detail.shipping_fee?.list_cost)} detail={detail.shipping_fee?.free_shipping_by_meli ? 'subsídio ML/Full' : 'sem frete grátis'} />
      </div>
    </div>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div style={{ minWidth: 160, background: '#f8fafc', border: '1px solid #e4e7ec', borderRadius: 12, padding: '.75rem .85rem' }}>
      <div style={{ fontSize: '.72rem', color: '#667085' }}>{label}</div>
      <div style={{ fontWeight: 800, color: '#101828' }}>{value}</div>
      <div style={{ fontSize: '.74rem', color: '#6941c6' }}>{detail}</div>
    </div>
  )
}

function InfoPanel({ title, lines, link, linkLabel }: { title: string; lines: string[]; link?: string; linkLabel?: string }) {
  return (
    <div style={{ border: '1px solid #e4e7ec', borderRadius: 16, padding: '1rem 1.1rem', background: '#fafbff' }}>
      <div style={{ fontWeight: 800, color: '#1d2939', marginBottom: '.75rem' }}>{title}</div>
      {lines.map(line => <div key={line} style={{ color: '#475467', marginBottom: '.45rem' }}>{line}</div>)}
      {link && <a href={link} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '.75rem', color: '#5b3cc4', fontWeight: 700 }}>{linkLabel || 'Abrir no ML'}</a>}
    </div>
  )
}

function DimInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '.35rem', color: '#475467' }}>
      {label}
      <input value={value} onChange={e => onChange(e.target.value)} style={{ border: '1px solid #d0d7e6', borderRadius: 10, padding: '.75rem .85rem' }} />
    </label>
  )
}

function RadioChip({ checked, onClick, label }: { checked: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} style={{ border: checked ? '2px solid #6d4bd2' : '1px solid #d0d7e6', background: checked ? '#f4f0ff' : '#fff', color: '#344054', borderRadius: 999, padding: '.7rem 1rem', cursor: 'pointer' }}>
      {label}
    </button>
  )
}

function swap<T>(arr: T[], a: number, b: number) {
  const next = [...arr]
  const tmp = next[a]
  next[a] = next[b]
  next[b] = tmp
  return next
}

const primaryBtn: CSSProperties = { padding: '.78rem 1.2rem', borderRadius: 10, border: '1px solid #5b3cc4', background: '#5b3cc4', color: '#fff', cursor: 'pointer', fontWeight: 700 }
const secondaryBtn: CSSProperties = { padding: '.78rem 1.2rem', borderRadius: 10, border: '1px solid #d0d5dd', background: '#fff', color: '#344054', cursor: 'pointer', fontWeight: 700 }
const miniBtn = (bg: string, color: string): CSSProperties => ({ flex: 1, border: 'none', borderRadius: 8, padding: '.42rem .5rem', background: bg, color, cursor: 'pointer', fontWeight: 700 })
