import { useState, type ReactNode } from "react";

/** Gráficos em SVG puro. Cores vêm por série (validadas com o validador da skill de dataviz). */
export interface Serie { chave: string; nome: string; cor: string }

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const diaCurto = (iso: string) => { const [, m, d] = iso.split("-"); return `${Number(d)} ${MESES[Number(m) - 1]}`; };

function teto(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

export function Legenda({ series }: { series: Serie[] }) {
  return (
    <ul className="legenda">
      {series.map((s) => <li key={s.chave}><span className="legenda-marca" style={{ background: s.cor }} />{s.nome}</li>)}
    </ul>
  );
}

function Dica({ x, y, largura, children }: { x: number; y: number; largura: number; children: ReactNode }) {
  const esquerda = x > largura * 0.6;
  return (
    <div className="dica-grafico" style={{ left: `${(x / largura) * 100}%`, top: y, transform: esquerda ? "translate(-104%, -50%)" : "translate(4%, -50%)" }}>
      {children}
    </div>
  );
}

interface Eixo { dados: Record<string, number | string>[]; series: Serie[]; formatar?: (v: number) => string }

/** Barras agrupadas por dia: volume por série ao longo do período. */
export function BarrasPorDia({ dados, series, formatar = String }: Eixo) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const L = 640, A = 190, esq = 34, base = A - 22;
  const max = teto(Math.max(1, ...dados.flatMap((d) => series.map((s) => Number(d[s.chave]) || 0))));
  const passo = (L - esq) / Math.max(1, dados.length);
  const barra = Math.max(2, Math.min(9, (passo - 6) / series.length - 2));
  const y = (v: number) => base - (v / max) * (base - 8);
  const marcas = [0, max / 2, max];
  return (
    <div className="grafico">
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-label="Devoluções por dia" onMouseLeave={() => setAtivo(null)}>
        {marcas.map((m) => (
          <g key={m}><line x1={esq} x2={L} y1={y(m)} y2={y(m)} className="grade" />
            <text x={esq - 6} y={y(m) + 4} textAnchor="end" className="eixo">{formatar(m)}</text></g>
        ))}
        {dados.map((d, i) => {
          const x0 = esq + i * passo + (passo - series.length * (barra + 2)) / 2;
          return (
            <g key={String(d.dia)}>
              <rect x={esq + i * passo} y={0} width={passo} height={base} className={ativo === i ? "faixa ativa" : "faixa"}
                    onMouseEnter={() => setAtivo(i)} />
              {series.map((s, k) => {
                const v = Number(d[s.chave]) || 0;
                return v > 0 && <path key={s.chave} fill={s.cor} pointerEvents="none"
                                      d={barraArredondada(x0 + k * (barra + 2), y(v), barra, base - y(v))} />;
              })}
              {(i % Math.ceil(dados.length / 8) === 0 || i === dados.length - 1) &&
                <text x={esq + i * passo + passo / 2} y={A - 6} textAnchor="middle" className="eixo">{diaCurto(String(d.dia))}</text>}
            </g>
          );
        })}
      </svg>
      {ativo !== null && (
        <Dica x={esq + ativo * passo + passo / 2} y={60} largura={L}>
          <strong>{diaCurto(String(dados[ativo].dia))}</strong>
          {series.map((s) => <span key={s.chave}><i style={{ background: s.cor }} />{s.nome}: {formatar(Number(dados[ativo][s.chave]) || 0)}</span>)}
        </Dica>
      )}
    </div>
  );
}

function barraArredondada(x: number, y: number, l: number, a: number) {
  const r = Math.min(4, l / 2, a);  // topo arredondado, base reta apoiada no eixo
  return `M${x},${y + a}V${y + r}Q${x},${y} ${x + r},${y}H${x + l - r}Q${x + l},${y} ${x + l},${y + r}V${y + a}Z`;
}

/** Linhas no tempo com cruz de leitura: comparar duas medidas na mesma escala (R$). */
export function LinhasNoTempo({ dados, series, formatar = String }: Eixo) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const L = 640, A = 190, esq = 52, base = A - 22;
  const max = teto(Math.max(1, ...dados.flatMap((d) => series.map((s) => Number(d[s.chave]) || 0))));
  const x = (i: number) => esq + (i * (L - esq - 8)) / Math.max(1, dados.length - 1);
  const y = (v: number) => base - (v / max) * (base - 8);
  const marcas = [0, max / 2, max];
  return (
    <div className="grafico">
      <svg viewBox={`0 0 ${L} ${A}`} role="img" aria-label="Custo e recuperado por dia"
           onMouseMove={(e) => {
             const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
             const px = ((e.clientX - r.left) / r.width) * L;
             setAtivo(Math.max(0, Math.min(dados.length - 1, Math.round(((px - esq) / (L - esq - 8)) * (dados.length - 1)))));
           }} onMouseLeave={() => setAtivo(null)}>
        {marcas.map((m) => (
          <g key={m}><line x1={esq} x2={L} y1={y(m)} y2={y(m)} className="grade" />
            <text x={esq - 6} y={y(m) + 4} textAnchor="end" className="eixo">{formatar(m)}</text></g>
        ))}
        {series.map((s) => {
          const pts = dados.map((d, i) => `${x(i)},${y(Number(d[s.chave]) || 0)}`).join(" L");
          return (
            <g key={s.chave}>
              <path d={`M${x(0)},${base} L${pts} L${x(dados.length - 1)},${base}Z`} fill={s.cor} opacity="0.08" />
              <path d={`M${pts}`} fill="none" stroke={s.cor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          );
        })}
        {dados.map((d, i) => (i % Math.ceil(dados.length / 8) === 0 || i === dados.length - 1) &&
          <text key={String(d.dia)} x={x(i)} y={A - 6} textAnchor="middle" className="eixo">{diaCurto(String(d.dia))}</text>)}
        {ativo !== null && (
          <g>
            <line x1={x(ativo)} x2={x(ativo)} y1={8} y2={base} className="cruz" />
            {series.map((s) => <circle key={s.chave} cx={x(ativo)} cy={y(Number(dados[ativo][s.chave]) || 0)} r="4.5"
                                       fill={s.cor} stroke="#fff" strokeWidth="2" />)}
          </g>
        )}
      </svg>
      {ativo !== null && (
        <Dica x={x(ativo)} y={60} largura={L}>
          <strong>{diaCurto(String(dados[ativo].dia))}</strong>
          {series.map((s) => <span key={s.chave}><i style={{ background: s.cor }} />{s.nome}: {formatar(Number(dados[ativo][s.chave]) || 0)}</span>)}
        </Dica>
      )}
    </div>
  );
}

/** Rosca de partes de um todo, com o total no centro. */
export function Rosca({ fatias, centro, rotulo }: { fatias: { nome: string; valor: number; cor: string }[]; centro: string; rotulo: string }) {
  const [ativa, setAtiva] = useState<number | null>(null);
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  const r = 46, c = 2 * Math.PI * r;
  let acumulado = 0;
  return (
    <svg viewBox="0 0 120 120" className="rosca" role="img" aria-label={fatias.map((f) => `${f.nome} ${f.valor}`).join(", ")}
         onMouseLeave={() => setAtiva(null)}>
      <circle cx="60" cy="60" r={r} className="rosca-trilho" />
      {total > 0 && fatias.map((f, i) => {
        const tam = (f.valor / total) * c;
        const vao = fatias.filter((x) => x.valor > 0).length > 1 ? 2 : 0;  // vão de 2px entre fatias
        const el = f.valor > 0 && (
          <circle key={f.nome} cx="60" cy="60" r={r} fill="none" stroke={f.cor} strokeWidth={ativa === i ? 14 : 11}
                  strokeDasharray={`${Math.max(0, tam - vao)} ${c - Math.max(0, tam - vao)}`} strokeDashoffset={-acumulado}
                  transform="rotate(-90 60 60)" onMouseEnter={() => setAtiva(i)} />
        );
        acumulado += tam;
        return el;
      })}
      <text x="60" y="58" textAnchor="middle" className="rosca-centro">{ativa !== null ? fatias[ativa].valor : centro}</text>
      <text x="60" y="74" textAnchor="middle" className="rosca-rotulo">{ativa !== null ? fatias[ativa].nome : rotulo}</text>
    </svg>
  );
}
