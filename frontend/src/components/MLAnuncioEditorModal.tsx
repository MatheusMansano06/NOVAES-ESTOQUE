import { useEffect, useMemo, useState, type CSSProperties } from 'react'

const API_BASE = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

type Mode = 'descricao' | 'imagens' | 'ficha' | 'dimensoes' | 'atacado' | 'flex'

interface TierAtacado {
  min_purchase_unit: number | string
  amount: number | string
}

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
  const [tiers, setTiers] = useState<TierAtacado[]>([])
  const [precoStandard, setPrecoStandard] = useState<number | null>(null)
  const [amostraB2b, setAmostraB2b] = useState<Array<{ quantidade: number; amount: number | null }>>([])
  const [temAtacado, setTemAtacado] = useState(false)
  const [atacadoLoading, setAtacadoLoading] = useState(false)

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

  useEffect(() => {
    if (mode !== 'atacado') return
    let active = true
    const loadAtacado = async () => {
      setAtacadoLoading(true)
      try {
        const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/precos-quantidade`, { cache: 'no-store' })
        const d = await r.json()
        if (!active) return
        if (r.ok && !d.erro) {
          setPrecoStandard(d.standard?.amount ?? null)
          setAmostraB2b(d.amostra_b2b || [])
          setTemAtacado(Boolean(d.tem_atacado))
        }
      } catch {
        /* ignore */
      } finally {
        if (active) setAtacadoLoading(false)
      }
    }
    loadAtacado()
    return () => { active = false }
  }, [mode, anuncio.id])

  const attrRows = useMemo(() => (detail?.attributes || []).filter(a => !a.id.startsWith('SELLER_PACKAGE_')), [detail])
  const dimensoesTravadas = Boolean(detail?.item?.full)

  const submitAtacado = async () => {
    setSaving(true)
    setError('')
    try {
      const payload = tiers
        .map(t => ({ min_purchase_unit: Number(t.min_purchase_unit), amount: Number(String(t.amount).replace(',', '.')) }))
        .filter(t => t.min_purchase_unit > 1 && t.amount > 0)
      const r = await fetch(`${API_BASE}/api/ml/anuncios/${anuncio.id}/precos-quantidade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tiers: payload }),
      })
      const d = await r.json()
      if (!r.ok || d.erro) throw new Error(d.erro || 'Falha ao salvar preços por quantidade')
      onUpdated()
      onClose()
    } catch (e) {
      setError(String(e))
    } finally {
      setSaving(false)
    }
  }

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
    imagens: 'Gerenciar Imagens do Anúncio',
    ficha: 'Ficha Técnica do Anúncio',
    dimensoes: 'Dimensões do Anúncio',
    atacado: 'Preços por Quantidade (Atacado B2B)',
    flex: 'Mercado Envios Flex',
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
            {mode === 'dimensoes' && dimensoesTravadas && (
              <div style={{ border: '1px solid #fcd9a8', background: '#fff8ee', borderRadius: 16, padding: '1.1rem 1.2rem' }}>
                <div style={{ fontWeight: 800, color: '#b54708', marginBottom: '.5rem' }}>Dimensões controladas pelo Mercado Livre (Full)</div>
                <p style={{ margin: '0 0 .6rem', color: '#7a5b2e', lineHeight: 1.5 }}>
                  Este anúncio usa logística <strong>Full</strong>: o galpão do Mercado Livre mede o produto fisicamente.
                  A alteração de dimensões não é aplicada (a API responde "sucesso" mas o valor não muda).
                </p>
                <div style={{ fontSize: '.85rem', color: '#7a5b2e' }}>
                  Medidas atuais (medidas pelo ML): <strong>{detail.item.dimensoes?.texto || '--'}</strong>
                </div>
              </div>
            )}
            {mode === 'dimensoes' && !dimensoesTravadas && (
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
            {mode === 'atacado' && (
              <div style={{ border: '1px solid #e5eaf3', borderRadius: 16, padding: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '.5rem', marginBottom: '.75rem' }}>
                  <span style={{ color: '#475467' }}>Preço unitário (padrão): <strong>{brl(precoStandard ?? detail.item.preco)}</strong></span>
                  <span style={{ fontSize: '.75rem', background: '#eef2ff', color: '#4338ca', padding: '3px 10px', borderRadius: 999, fontWeight: 700 }}>B2B · comprador empresa</span>
                </div>
                <p style={{ margin: '0 0 .85rem', color: '#667085', fontSize: '.85rem', lineHeight: 1.5 }}>
                  Defina descontos por quantidade mínima. Esses preços só aparecem para <strong>compradores empresa (B2B)</strong> no Mercado Livre. Até 5 faixas.
                </p>
                {amostraB2b.length > 0 && (
                  <div style={{ marginBottom: '1rem', padding: '.7rem .85rem', background: temAtacado ? '#ecfdf3' : '#f8fafc', border: `1px solid ${temAtacado ? '#abefc6' : '#e4e7ec'}`, borderRadius: 10 }}>
                    <div style={{ fontSize: '.72rem', color: '#667085', marginBottom: '.4rem', textTransform: 'uppercase', letterSpacing: '.03em' }}>
                      Preço B2B atual {temAtacado ? '(atacado ativo)' : '(sem desconto por quantidade)'}
                    </div>
                    <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap' }}>
                      {amostraB2b.map(s => (
                        <span key={s.quantidade} style={{ fontSize: '.85rem', color: '#1d2939' }}>
                          {s.quantidade}un: <strong>{brl(s.amount)}</strong>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {atacadoLoading ? <div style={{ color: '#667085' }}>Carregando preços B2B...</div> : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
                    {tiers.length === 0 && <div style={{ color: '#98a2b3', fontSize: '.85rem' }}>Adicione faixas abaixo para definir descontos por quantidade.</div>}
                    {tiers.map((t, i) => (
                      <div key={i} style={{ display: 'flex', gap: '.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ color: '#475467', fontSize: '.85rem' }}>A partir de</span>
                        <input type="number" min={2} value={t.min_purchase_unit} onChange={e => setTiers(prev => prev.map((x, j) => j === i ? { ...x, min_purchase_unit: e.target.value } : x))} style={{ width: 90, border: '1px solid #d0d7e6', borderRadius: 8, padding: '.5rem .6rem' }} />
                        <span style={{ color: '#475467', fontSize: '.85rem' }}>un. →</span>
                        <span style={{ color: '#475467', fontSize: '.85rem' }}>R$</span>
                        <input type="text" inputMode="decimal" value={t.amount} onChange={e => setTiers(prev => prev.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} placeholder="0,00" style={{ width: 110, border: '1px solid #d0d7e6', borderRadius: 8, padding: '.5rem .6rem' }} />
                        <button onClick={() => setTiers(prev => prev.filter((_, j) => j !== i))} style={miniBtn('#fee4e2', '#b42318')}>Remover</button>
                      </div>
                    ))}
                    {tiers.length < 5 && (
                      <button onClick={() => setTiers(prev => [...prev, { min_purchase_unit: '', amount: '' }])} style={{ alignSelf: 'flex-start', marginTop: '.3rem', border: '1px dashed #c4b5fd', background: '#f5f3ff', color: '#5b21b6', borderRadius: 10, padding: '.5rem .9rem', cursor: 'pointer', fontWeight: 700 }}>+ Adicionar faixa</button>
                    )}
                  </div>
                )}
                <div style={{ marginTop: '.85rem', fontSize: '.75rem', color: '#98a2b3', lineHeight: 1.5 }}>
                  Salvar com a lista vazia remove todas as faixas de atacado do anúncio.<br />
                  Atenção: anúncios com promoção/campanha ativa podem não aceitar preços por quantidade - o sistema avisa se o ML não aplicar.
                </div>
              </div>
            )}
            {mode === 'flex' && (
              <div style={{ border: '1px solid #e5eaf3', borderRadius: 16, padding: '1.1rem 1.2rem' }}>
                <div style={{ fontWeight: 800, color: '#1d2939', marginBottom: '.6rem' }}>
                  {detail.item.full ? 'Full + Flex (coexistência)' : (detail.item.flex ? 'Flex ativo neste anúncio' : 'Logística: ' + (detail.item.logistica || '--'))}
                </div>
                <p style={{ margin: '0 0 .6rem', color: '#475467', lineHeight: 1.5 }}>
                  Logística atual: <strong>{detail.item.logistica || '--'}</strong>. Tags de envio: {(detail.shipping_tags || []).join(', ') || '--'}.
                </p>
                <p style={{ margin: 0, color: '#667085', fontSize: '.85rem', lineHeight: 1.5 }}>
                  O Flex é ativado/configurado <strong>no nível da conta</strong> (reputação, área de cobertura e endereço de coleta), não anúncio a anúncio pela API.
                  Sua conta já está habilitada para Flex em coexistência com o Full.
                </p>
                {detail.item.permalink && <a href={detail.item.permalink} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: '.7rem', color: '#5b3cc4', fontWeight: 700 }}>Abrir anúncio no Mercado Livre</a>}
              </div>
            )}

            <div style={{ marginTop: '1.25rem', display: 'flex', justifyContent: 'flex-end', gap: '.75rem', flexWrap: 'wrap' }}>
              <button onClick={onClose} style={secondaryBtn}>Fechar</button>
              {mode === 'descricao' && <button onClick={submitDescricao} disabled={saving} style={primaryBtn}>{saving ? 'Salvando...' : 'Salvar'}</button>}
              {mode === 'imagens' && <button onClick={submitImagens} disabled={saving} style={primaryBtn}>{saving ? 'Salvando...' : 'Salvar'}</button>}
              {mode === 'ficha' && <button onClick={submitFicha} disabled={saving} style={primaryBtn}>{saving ? 'Salvando...' : 'Salvar'}</button>}
              {mode === 'dimensoes' && !dimensoesTravadas && <button onClick={submitDimensoes} disabled={saving} style={primaryBtn}>{saving ? 'Salvando...' : 'Salvar'}</button>}
              {mode === 'atacado' && <button onClick={submitAtacado} disabled={saving} style={primaryBtn}>{saving ? 'Salvando...' : 'Salvar atacado'}</button>}
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
