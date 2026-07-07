import { useMemo, useState } from 'react'
import {
  calcularDifal, carregarConfig, salvarConfig, configPadrao, aliquotaInterestadual,
  UFS, NOME_UF, INTERNAS_PADRAO, type UF, type DifalConfig, type EntradaVenda,
} from './difal'

const brl = (v: number) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const pc = (v: number) => Number(v).toFixed(1).replace('.', ',') + '%'

export function DifalPanel({ entradas, receitaTotal, vendasTotal, vendasLocalizadas, expandido: expandidoInicialmente = false, onToggleExpandido }: {
  entradas: EntradaVenda[]
  receitaTotal: number
  vendasTotal: number
  vendasLocalizadas: number
  expandido?: boolean
  onToggleExpandido?: (expandido: boolean) => void
}) {
  const [config, setConfig] = useState<DifalConfig>(() => carregarConfig())
  const [abrirConfig, setAbrirConfig] = useState(false)
  const [expandido, setExpandido] = useState(expandidoInicialmente)

  const atualizar = (novo: DifalConfig) => { setConfig(novo); salvarConfig(novo) }
  const toggle = (novoExpandido: boolean) => { setExpandido(novoExpandido); onToggleExpandido?.(novoExpandido) }

  const res = useMemo(() => calcularDifal(entradas, config), [entradas, config])
  const cobertura = vendasTotal > 0 ? vendasLocalizadas / vendasTotal : 0
  // Projeção p/ o total: escala o DIFAL localizado pela receita total (mesmo mix de estados)
  const projecao = res.totalBase > 0 && cobertura < 0.999 ? res.totalDifal * (receitaTotal / res.totalBase) : null
  const pctSobreBase = res.baseInterestadual > 0 ? (res.totalDifal / res.baseInterestadual) * 100 : 0

  // Estados presentes nas vendas (pra grade de config enxuta)
  const ufsPresentes = useMemo(
    () => [...new Set(entradas.map(e => e.uf))].filter(Boolean).sort() as UF[],
    [entradas])

  return (
    <div style={{ background: '#fff', border: '1px solid #eaecf0', borderRadius: 12, padding: '0.9rem 1.25rem', margin: '0 1.25rem 0.9rem', }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: '.85rem', fontWeight: 800, color: '#101828' }}>🧾 DIFAL estimado</span>
        <span style={{ fontSize: '.7rem', color: '#98a2b3' }}>origem {config.origem} · Lucro Presumido{config.importado ? ' · importado 4%' : ''}</span>
        <button onClick={() => toggle(!expandido)}
          style={{ marginLeft: 'auto', padding: '5px 11px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fff', color: '#3538cd', fontSize: '.76rem', fontWeight: 600, cursor: 'pointer' }}>
          {expandido ? '▼' : '▶'} {expandido ? 'Ocultar' : 'Mostrar'} detalhes
        </button>
      </div>

      {/* Totais */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 10 }}>
        <div style={{ background: '#fef3f2', border: '1px solid #fecdca', borderRadius: 10, padding: '.55rem .85rem', minWidth: 150 }}>
          <div style={{ fontSize: '.68rem', color: '#b42318', textTransform: 'uppercase', letterSpacing: '.3px' }}>DIFAL total (localizado)</div>
          <div style={{ fontWeight: 800, color: '#b42318', fontSize: '1.1rem' }}>{brl(res.totalDifal)}</div>
          <div style={{ fontSize: '.68rem', color: '#98a2b3' }}>{pc(pctSobreBase)} da base interestadual</div>
        </div>
        {projecao != null && (
          <div style={{ background: '#f9fafb', border: '1px solid #eaecf0', borderRadius: 10, padding: '.55rem .85rem', minWidth: 150 }}>
            <div style={{ fontSize: '.68rem', color: '#667085', textTransform: 'uppercase', letterSpacing: '.3px' }}>Projeção p/ total</div>
            <div style={{ fontWeight: 800, color: '#475467', fontSize: '1.1rem' }}>{brl(projecao)}</div>
            <div style={{ fontSize: '.68rem', color: '#98a2b3' }}>estimado sobre todo o faturamento</div>
          </div>
        )}
      </div>

      {/* Config de alíquotas (dentro de expandido) */}
      {expandido && (
        <>
          <div style={{ marginTop: 10 }}>
            <button onClick={() => setAbrirConfig(v => !v)}
              style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid #d0d5dd', background: '#fff', color: '#667085', fontSize: '.76rem', fontWeight: 600, cursor: 'pointer' }}>
              ⚙️ {abrirConfig ? 'Fechar' : 'Editar'} alíquotas
            </button>
          </div>
          {abrirConfig && (
            <div style={{ marginTop: 12, padding: '0.85rem', background: '#f9fafb', border: '1px solid #eaecf0', borderRadius: 10 }}>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10 }}>
                <label style={{ fontSize: '.78rem', color: '#475467', display: 'flex', alignItems: 'center', gap: 6 }}>
                  Origem:
                  <select value={config.origem} onChange={e => atualizar({ ...config, origem: e.target.value as UF })}
                    style={{ padding: '4px 8px', border: '1px solid #d0d5dd', borderRadius: 6, fontSize: '.78rem' }}>
                    {UFS.map(u => <option key={u} value={u}>{u} — {NOME_UF[u]}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '.78rem', color: '#475467', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={config.importado} onChange={e => atualizar({ ...config, importado: e.target.checked })} />
                  Produto importado (interestadual 4%)
                </label>
                <button onClick={() => atualizar(configPadrao(config.origem))}
                  style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #d0d5dd', background: '#fff', color: '#667085', fontSize: '.74rem', cursor: 'pointer' }}>
                  Restaurar padrão
                </button>
              </div>
              <div style={{ fontSize: '.72rem', color: '#667085', marginBottom: 6 }}>Alíquota interna (%) por estado de destino — ajuste conforme cada UF:</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(88px, 1fr))', gap: 6 }}>
                {(ufsPresentes.length ? ufsPresentes : UFS).map(uf => (
                  <label key={uf} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '.74rem', color: '#475467' }}>
                    <span style={{ fontWeight: 700, minWidth: 22 }}>{uf}</span>
                    <input type="number" step="0.5" value={config.internas[uf] ?? INTERNAS_PADRAO[uf]}
                      onChange={e => atualizar({ ...config, internas: { ...config.internas, [uf]: parseFloat(e.target.value) || 0 } })}
                      style={{ width: 52, padding: '3px 5px', border: '1px solid #d0d5dd', borderRadius: 5, fontSize: '.74rem' }} />
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Tabela por estado (só quando expandido) */}
      {expandido && res.linhas.length > 0 && (
        <div style={{ marginTop: 12, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '.76rem' }}>
            <thead>
              <tr style={{ color: '#98a2b3', textAlign: 'right' }}>
                <th style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 600 }}>UF</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Vendas</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Base</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Interest.</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Interna</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>Alíq. DIFAL</th>
                <th style={{ padding: '4px 8px', fontWeight: 600 }}>DIFAL</th>
              </tr>
            </thead>
            <tbody>
              {res.linhas.map(l => (
                <tr key={l.uf} style={{ borderTop: '1px solid #f0f0f0', textAlign: 'right', color: l.uf === config.origem ? '#98a2b3' : '#1d2939' }}>
                  <td style={{ textAlign: 'left', padding: '4px 8px', fontWeight: 700 }}>
                    {l.uf}{l.uf === config.origem && <span style={{ fontSize: '.66rem', color: '#98a2b3', fontWeight: 500 }}> (interna)</span>}
                  </td>
                  <td style={{ padding: '4px 8px' }}>{l.vendas}</td>
                  <td style={{ padding: '4px 8px' }}>{brl(l.base)}</td>
                  <td style={{ padding: '4px 8px' }}>{l.uf === config.origem ? '—' : pc(l.interestadual)}</td>
                  <td style={{ padding: '4px 8px' }}>{pc(l.interna)}</td>
                  <td style={{ padding: '4px 8px' }}>{l.uf === config.origem ? '—' : pc(l.aliquotaDifal)}</td>
                  <td style={{ padding: '4px 8px', fontWeight: 700, color: l.difal > 0 ? '#b42318' : '#98a2b3' }}>{l.difal > 0 ? brl(l.difal) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 10, fontSize: '.68rem', color: '#98a2b3', lineHeight: 1.5 }}>
        📍 Calculado sobre {vendasLocalizadas} de {vendasTotal} vendas localizadas{cobertura < 0.999 ? ' (o resto ainda está sendo sincronizado)' : ''}.
        Estimativa gerencial — não considera base dupla (LC 190/2022), FECP nem benefícios fiscais. Confirme com seu contador.
      </div>
    </div>
  )
}
