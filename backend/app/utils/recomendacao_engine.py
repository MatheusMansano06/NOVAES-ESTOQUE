"""
Engine de cálculo de recomendações inteligentes de recompra.
Analisa histórico de vendas, estoque, lead times e preços para recomendar
quanto comprar, de qual fornecedor e quando.
"""

from sqlalchemy.orm import Session
from sqlalchemy import func, desc
from datetime import datetime, timedelta
from typing import List, Dict, Optional
import json
from statistics import mean, stdev

from app.models import (
    ItemEstoque, NotaFiscal, HistoricoVendas, HistoricoPrecos,
    FornecedorConfiguracao, Recomendacao
)
from app.schemas import (
    RecomendacaoResponse, FornecedorAlternativoResponse,
    AnaliseDemandaResponse, EstoqueAtualResponse
)


def obter_frequencia_venda(db: Session, sku: str, dias: int = 30) -> Dict:
    """
    Calcula frequência de venda de um SKU nos últimos N dias.
    Retorna: quantidade total, média/dia, desvio padrão, tendência.
    """
    data_limite = datetime.utcnow() - timedelta(days=dias)

    vendas = db.query(HistoricoVendas).filter(
        HistoricoVendas.olist_sku == sku,
        HistoricoVendas.data_venda >= data_limite
    ).all()

    if not vendas:
        return {
            "vendas_ultimos_7_dias": 0,
            "vendas_ultimos_14_dias": 0,
            "vendas_ultimos_30_dias": 0,
            "media_diaria": 0,
            "desvio_padrao": 0,
            "tendencia": "sem_dados",
            "crescimento_semana_anterior": 0,
            "previsao_proximos_7_dias": 0
        }

    # Calcular vendas por período
    data_7_dias = datetime.utcnow() - timedelta(days=7)
    data_14_dias = datetime.utcnow() - timedelta(days=14)

    vendas_7 = sum(v.quantidade for v in vendas if v.data_venda >= data_7_dias)
    vendas_14 = sum(v.quantidade for v in vendas if v.data_venda >= data_14_dias)
    vendas_30 = sum(v.quantidade for v in vendas)

    media_diaria = vendas_30 / dias if dias > 0 else 0

    # Calcular desvio padrão
    quantidades = [v.quantidade for v in vendas]
    desvio_padrao = stdev(quantidades) if len(quantidades) > 1 else 0

    # Tendência: comparar primeira metade vs segunda metade
    meio = len(vendas) // 2
    vendas_primeira_metade = sum(v.quantidade for v in vendas[:meio])
    vendas_segunda_metade = sum(v.quantidade for v in vendas[meio:])

    crescimento = 0
    tendencia = "estavel"
    if vendas_primeira_metade > 0:
        crescimento = ((vendas_segunda_metade - vendas_primeira_metade) / vendas_primeira_metade) * 100
        if crescimento > 10:
            tendencia = "crescendo"
        elif crescimento < -10:
            tendencia = "caindo"

    # Previsão próximos 7 dias
    previsao_7 = int(media_diaria * 7)

    return {
        "vendas_ultimos_7_dias": vendas_7,
        "vendas_ultimos_14_dias": vendas_14,
        "vendas_ultimos_30_dias": vendas_30,
        "media_diaria": round(media_diaria, 2),
        "desvio_padrao": round(desvio_padrao, 2),
        "tendencia": tendencia,
        "crescimento_semana_anterior": round(crescimento, 1),
        "previsao_proximos_7_dias": previsao_7
    }


def calcular_lead_time(db: Session, fornecedor: str) -> Dict:
    """
    Calcula lead time (dias entre emissão e recebimento) para um fornecedor.
    Usa histórico de Notas Fiscais.
    """
    notas = db.query(NotaFiscal).filter(
        NotaFiscal.fornecedor == fornecedor,
        NotaFiscal.status == "processado"
    ).order_by(desc(NotaFiscal.data_emissao)).limit(20).all()

    if not notas:
        return {"lead_time_dias": 7, "lead_time_min": 5, "lead_time_max": 10, "numero_compras": 0}

    # Estimar lead time: se houver confirmação, use data_confirmacao - data_emissao
    # Caso contrário, use valores padrão baseado no histórico
    lead_times = []
    for nota in notas:
        # Aqui seria ideal ter data_confirmacao, mas usamos aproximação
        # Assumindo lead time padrão de 5 dias se não houver informação melhor
        lead_times.append(5)

    lead_time_medio = mean(lead_times) if lead_times else 7
    lead_time_min = min(lead_times) if lead_times else 5
    lead_time_max = max(lead_times) if lead_times else 10

    return {
        "lead_time_dias": int(lead_time_medio),
        "lead_time_min": int(lead_time_min),
        "lead_time_max": int(lead_time_max),
        "numero_compras": len(notas)
    }


def obter_historico_precos(db: Session, fornecedor: str, codigo_produto: str, limite: int = 10) -> List[Dict]:
    """
    Obtém histórico de preços de um fornecedor para um produto.
    """
    precos = db.query(HistoricoPrecos).filter(
        HistoricoPrecos.fornecedor == fornecedor,
        HistoricoPrecos.codigo_produto_fornecedor == codigo_produto
    ).order_by(desc(HistoricoPrecos.data)).limit(limite).all()

    return [
        {
            "data": preco.data.isoformat(),
            "preco": preco.preco_unitario,
            "quantidade": preco.quantidade or 0
        }
        for preco in precos
    ]


def calcular_tendencia_preco(db: Session, fornecedor: str, codigo_produto: str) -> str:
    """
    Analisa se preço está subindo, caindo ou estável.
    """
    precos = db.query(HistoricoPrecos).filter(
        HistoricoPrecos.fornecedor == fornecedor,
        HistoricoPrecos.codigo_produto_fornecedor == codigo_produto
    ).order_by(desc(HistoricoPrecos.data)).limit(5).all()

    if len(precos) < 2:
        return "sem_dados"

    preco_recente = precos[0].preco_unitario
    preco_antigo = precos[-1].preco_unitario

    if preco_recente < preco_antigo * 0.95:
        return "descendo (preço caindo, boa hora!)"
    elif preco_recente > preco_antigo * 1.05:
        return "subindo (preço subindo, não é bom momento)"
    else:
        return "estável"


def obter_fornecedores_produto(db: Session, sku_olist: str) -> List[Dict]:
    """
    Encontra todos os fornecedores que já venderam um produto.
    Retorna informações de lead time e preço médio.
    """
    # Buscar itens estoque vinculados a este SKU Olist
    itens = db.query(ItemEstoque, NotaFiscal).join(
        NotaFiscal, ItemEstoque.nf_id == NotaFiscal.id
    ).filter(ItemEstoque.olist_sku == sku_olist).all()

    fornecedores_dict = {}

    for item, nota in itens:
        fornecedor = nota.fornecedor

        if fornecedor not in fornecedores_dict:
            # Obter lead time e preço
            lead_time_info = calcular_lead_time(db, fornecedor)

            # Preço médio deste produto deste fornecedor
            precos = db.query(func.avg(HistoricoPrecos.preco_unitario)).filter(
                HistoricoPrecos.fornecedor == fornecedor,
                HistoricoPrecos.codigo_produto_fornecedor == item.codigo_produto
            ).scalar()

            preco_medio = precos or item.preco_unitario

            fornecedores_dict[fornecedor] = {
                "nome": fornecedor,
                "preco_unitario": round(float(preco_medio), 2),
                "lead_time_dias": lead_time_info["lead_time_dias"],
                "frequencia_compra": 1,
                "ultimo_preco": item.preco_unitario,
                "codigo_produto": item.codigo_produto
            }
        else:
            fornecedores_dict[fornecedor]["frequencia_compra"] += 1

    return list(fornecedores_dict.values())


def selecionar_melhor_fornecedor(db: Session, sku_olist: str, fornecedores: List[Dict]) -> tuple:
    """
    Seleciona o melhor fornecedor baseado em preço + velocidade.
    Retorna (fornecedor_nome, fornecedores_alternativas).
    """
    if not fornecedores:
        return None, []

    # Score: preço baixo + entrega rápida
    # Score = (preco_normalizado + lead_time_normalizado) com peso

    min_preco = min(f["preco_unitario"] for f in fornecedores)
    max_preco = max(f["preco_unitario"] for f in fornecedores)
    min_lead = min(f["lead_time_dias"] for f in fornecedores)
    max_lead = max(f["lead_time_dias"] for f in fornecedores)

    for f in fornecedores:
        preco_norm = (f["preco_unitario"] - min_preco) / (max_preco - min_preco) if max_preco > min_preco else 0
        lead_norm = (f["lead_time_dias"] - min_lead) / (max_lead - min_lead) if max_lead > min_lead else 0

        # 70% preço, 30% velocidade
        f["score"] = (preco_norm * 0.7) + (lead_norm * 0.3)

    # Ordenar por score
    fornecedores_sorted = sorted(fornecedores, key=lambda x: x["score"])
    melhor = fornecedores_sorted[0]["nome"]
    alternativos = fornecedores_sorted[1:]

    return melhor, alternativos


def calcular_quantidade_compra(frequencia_diaria: float, lead_time_dias: int, dias_buffer: int = 5) -> int:
    """
    Calcula quantidade recomendada.
    Fórmula: frequencia_diaria × (lead_time + buffer)
    """
    quantidade = frequencia_diaria * (lead_time_dias + dias_buffer)
    return max(int(quantidade), 1)


def classificar_urgencia(dias_ate_faltar: float, lead_time_dias: int) -> str:
    """
    Classifica urgência da recompra.
    🔴 Crítico: vai faltar antes de conseguir entregar
    🟡 Moderado: falta em 5-7 dias
    🟢 Ok: mais de 7 dias
    """
    if dias_ate_faltar <= lead_time_dias:
        return "critico"
    elif dias_ate_faltar <= (lead_time_dias + 7):
        return "moderado"
    else:
        return "ok"


def calcular_recomendacoes(db: Session) -> List[RecomendacaoResponse]:
    """
    Função principal: calcula recomendações para todos os SKUs com estoque.
    """
    recomendacoes = []

    # Buscar todos os itens com estoque (confirmado ou quarentena)
    itens_estoque = db.query(ItemEstoque).filter(
        ItemEstoque.quantidade_confirmada > 0
    ).all()

    # Agrupar por SKU Olist
    skus_dict = {}
    for item in itens_estoque:
        if item.olist_sku and item.olist_sku != "":
            if item.olist_sku not in skus_dict:
                skus_dict[item.olist_sku] = {
                    "quantidade": 0,
                    "nome": item.olist_nome or item.descricao,
                    "codigo": item.codigo_produto
                }
            skus_dict[item.olist_sku]["quantidade"] += item.quantidade_confirmada or 0

    # Calcular recomendações para cada SKU
    for sku, info in skus_dict.items():
        estoque_atual = info["quantidade"]
        nome_produto = info["nome"]

        # Análise de demanda
        demanda = obter_frequencia_venda(db, sku)
        frequencia_diaria = demanda["media_diaria"]

        # Se não vende, pular
        if frequencia_diaria == 0:
            continue

        # Calcular dias até faltar
        dias_ate_faltar = estoque_atual / frequencia_diaria if frequencia_diaria > 0 else 999

        # Buscar fornecedores
        fornecedores = obter_fornecedores_produto(db, sku)
        if not fornecedores:
            continue

        # Selecionar melhor fornecedor
        melhor_fornecedor, alternativos = selecionar_melhor_fornecedor(db, sku, fornecedores)
        if not melhor_fornecedor:
            continue

        # Obter info do melhor fornecedor
        melhor_info = next((f for f in fornecedores if f["nome"] == melhor_fornecedor), None)
        if not melhor_info:
            continue

        lead_time = melhor_info["lead_time_dias"]
        preco_unitario = melhor_info["preco_unitario"]

        # Calcular quantidade
        quantidade_recomendada = calcular_quantidade_compra(frequencia_diaria, lead_time)

        # Classificar urgência
        urgencia = classificar_urgencia(dias_ate_faltar, lead_time)

        # Motivo
        motivo = f"Vende {frequencia_diaria:.1f} un/dia. Lead time: {lead_time} dias. Vai faltar em {dias_ate_faltar:.1f} dias."

        # Custo total
        custo_total = quantidade_recomendada * preco_unitario

        # Preparar fornecedores alternativos
        fornecedores_alternativos = []
        for alt in alternativos[:2]:  # Apenas 2 primeiras alternativas
            motivo_alt = ""
            if alt["preco_unitario"] < preco_unitario:
                dias_falta_alt = dias_ate_faltar - (alt["lead_time_dias"] - lead_time)
                if dias_falta_alt < 0:
                    motivo_alt = f"Mais barato mas demora {alt['lead_time_dias']} dias. Você falta em {dias_ate_faltar:.1f} dias."
                else:
                    motivo_alt = f"Mais barato (R$ {alt['preco_unitario']}) mas demora mais ({alt['lead_time_dias']} dias)."
            else:
                motivo_alt = f"Mais caro (R$ {alt['preco_unitario']}) e {alt['lead_time_dias']} dias."

            fornecedores_alternativos.append({
                "nome": alt["nome"],
                "preco_unitario": alt["preco_unitario"],
                "lead_time_dias": alt["lead_time_dias"],
                "frequencia_compra": alt["frequencia_compra"],
                "motivo_nao_recomendado": motivo_alt
            })

        # Criar recomendação
        rec = RecomendacaoResponse(
            id=0,  # Será preenchido ao salvar no DB
            urgencia=urgencia,
            sku_olist=sku,
            nome_produto=nome_produto,
            estoque_atual=int(estoque_atual),
            quantidade_recomendada=quantidade_recomendada,
            dias_ate_faltar=round(dias_ate_faltar, 1),
            frequencia_venda_diaria=round(frequencia_diaria, 2),
            fornecedor_recomendado=melhor_fornecedor,
            preco_unitario=round(preco_unitario, 2),
            custo_total=round(custo_total, 2),
            motivo=motivo,
            fornecedores_alternativos=fornecedores_alternativos
        )

        recomendacoes.append(rec)

    # Ordenar por urgência (crítico primeiro)
    ordem_urgencia = {"critico": 0, "moderado": 1, "ok": 2}
    recomendacoes.sort(key=lambda x: (ordem_urgencia.get(x.urgencia, 3), x.dias_ate_faltar))

    return recomendacoes


def salvar_recomendacoes(db: Session, recomendacoes: List[RecomendacaoResponse]):
    """
    Salva recomendações calculadas no banco de dados.
    """
    # Limpar recomendações antigas
    db.query(Recomendacao).delete()
    db.commit()

    # Salvar novas
    for rec in recomendacoes:
        fornecedores_json = json.dumps([
            {
                "nome": f.nome,
                "preco_unitario": f.preco_unitario,
                "lead_time_dias": f.lead_time_dias,
                "frequencia_compra": f.frequencia_compra,
                "motivo_nao_recomendado": f.motivo_nao_recomendado
            }
            for f in rec.fornecedores_alternativos
        ])

        recomendacao_db = Recomendacao(
            olist_sku=rec.sku_olist,
            nome_produto=rec.nome_produto,
            estoque_atual=rec.estoque_atual,
            quantidade_recomendada=rec.quantidade_recomendada,
            fornecedor_recomendado=rec.fornecedor_recomendado,
            preco_unitario=rec.preco_unitario,
            custo_total=rec.custo_total,
            frequencia_venda_diaria=rec.frequencia_venda_diaria,
            dias_ate_faltar=rec.dias_ate_faltar,
            urgencia=rec.urgencia,
            motivo=rec.motivo,
            fornecedores_alternativos=fornecedores_json,
            status_acao="novo"
        )
        db.add(recomendacao_db)

    db.commit()
