"""Orquestra a conferência: junta devolução + Olist + custo e registra o que o operador constatou.
É a única trilha que conhece as outras; nenhuma delas depende desta."""

import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import BinaryIO

from sqlalchemy import select

from app.central.devolucoes import servico as devolucoes
from app.central.devolucoes.modelo import Devolucao
from app.central.devolucoes.servico import publico
from app.central.financeiro.custos import custo_do_sku
from app.central.mercado_livre import acoes as ml_acoes
from app.central.olist import servico as olist
from app.central.db import UPLOADS, Sessao

from .etiquetas import extrair
from .modelo import Conferencia, Evidencia
from .regras import EVIDENCIAS, decidir

PASTA = UPLOADS / "evidencias"
TIPOS = {  # content-type aceito → (tipo, extensão). Nome do arquivo do usuário nunca é usado.
    "image/jpeg": ("foto", ".jpg"), "image/png": ("foto", ".png"), "image/webp": ("foto", ".webp"),
    "video/mp4": ("video", ".mp4"), "video/webm": ("video", ".webm"), "video/quicktime": ("video", ".mov"),
}
LIMITE = {"foto": 15 * 2**20, "video": 200 * 2**20}
CAMPOS = ("sku_recebido", "produto_correto", "completo", "sem_uso", "revendavel", "erro_nosso", "observacao")


def _agora() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _colunas(obj) -> dict:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def _olist(d: Devolucao) -> dict:
    """Falha da Olist aparece na tela, mas não impede o operador de conferir."""
    try:
        pedidos = olist.pedidos_do_marketplace(d.pacote or d.pedido)
        if not pedidos and d.pacote:
            pedidos = olist.pedidos_do_marketplace(d.pedido)
    except RuntimeError as e:
        return {"erro": str(e), "pedidos": []}
    _indexar_notas(d.id, pedidos)
    for p in pedidos:
        for item in p["itens"]:
            try:
                item["custo"] = custo_do_sku(item["sku"])
            except RuntimeError:
                item["custo"] = None
    return {"erro": None, "pedidos": pedidos}


def aquecer_cache(limite: int = 60) -> int:
    """Deixa pronto na Olist o que vai ser conferido (a caminho ou entregue na Novaes): o bipe abre na hora."""
    with Sessao() as s:
        devs = s.scalars(select(Devolucao).where(
            Devolucao.destino == "vendedor", Devolucao.etapa.in_(("em_transito", "entregue"))
        ).order_by(Devolucao.atualizada_em.desc()).limit(limite)).all()
        chaves = [(d.id, d.pacote, d.pedido) for d in devs]
    for devolucao_id, pacote, pedido in chaves:
        pedidos = olist.pedidos_do_marketplace(pacote or pedido)
        if not pedidos and pacote:
            pedidos = olist.pedidos_do_marketplace(pedido)
        _indexar_notas(devolucao_id, pedidos)
    return len(chaves)


def _indexar_notas(devolucao_id: int, pedidos: list[dict]) -> None:
    """A DANFE vai colada no pacote: o código de barras dela (chave da NF de venda) também acha a devolução."""
    chaves = [p["nota"]["chave"] for p in pedidos if p.get("nota") and p["nota"].get("chave")]
    if chaves:
        devolucoes.adicionar_codigos(devolucao_id, chaves, "olist")


def resolver(bruto: str) -> list[int]:
    """Qualquer coisa bipada → devoluções. Primeiro o índice de códigos; se não achar, pergunta ao ML de que
    pedido é aquele número de envio e aprende o código para o próximo bipe."""
    candidatos = extrair(bruto)
    if ids := devolucoes.ids_por_codigos(candidatos):
        return ids
    for c in (c for c in candidatos if c.isdigit() and 10 <= len(c) <= 12):  # formato de id de envio do ML
        try:
            pedido = ml_acoes.pedido_do_envio(c)
        except RuntimeError:
            continue
        if pedido and (ids := devolucoes.ids_por_codigos([pedido])):
            for i in ids:
                devolucoes.adicionar_codigos(i, [c], "bipe", substituir=False)
            return ids
    return []


# ponytail: URLs do painel do vendedor montadas à mão (as APIs não devolvem link); se a plataforma mudar, é aqui.
LINK_PLATAFORMA = {
    "mercado_livre": lambda d: f"https://www.mercadolivre.com.br/vendas/{d.pacote or d.pedido}/detalhe",
    "shopee": lambda d: f"https://seller.shopee.com.br/portal/sale/return/{d.id_externo}",
}


def _fotos_anuncio_ml(item_ids: list[str]) -> dict[str, str]:
    """Foto do anúncio do cache local do ML (sem chamada à API). -I.jpg é miniatura; -O.jpg é a original."""
    from database import SessionLocal
    from app.models import MercadoLivreItemCache
    db = SessionLocal()
    try:
        linhas = db.query(MercadoLivreItemCache.item_id, MercadoLivreItemCache.thumbnail)                    .filter(MercadoLivreItemCache.item_id.in_(item_ids)).all()
    finally:
        db.close()
    return {i: t.replace("-I.jpg", "-O.jpg") for i, t in linhas if t}


def _midia(d: Devolucao) -> dict:
    """Conferência visual: foto do anúncio vendido, link para a reclamação e o que o comprador anexou."""
    if d.plataforma == "mercado_livre":
        fotos = _fotos_anuncio_ml([str(i.get("item_id")) for i in d.itens if i.get("item_id")])
        anuncio = [{"nome": i.get("nome"), "imagem": fotos.get(str(i.get("item_id")))} for i in d.itens]
        comprador = {"fotos": [], "videos": []}  # no ML ficam na reclamação, atrás do login: vai pelo link
    else:
        anuncio = [{"nome": i.get("nome"), "imagem": i.get("imagem")} for i in d.itens]
        bruto = (d.bruto or {}).get("devolucao") or {}
        comprador = {"fotos": bruto.get("image") or [],
                     "videos": [v["video_url"] for v in bruto.get("buyer_videos") or [] if v.get("video_url")]}
    link = LINK_PLATAFORMA.get(d.plataforma)
    return {"anuncio": anuncio, "comprador": comprador, "link": link(d) if link else None}


def buscar(codigo: str) -> list[dict]:
    """O que o leitor de código de barras chama: etiqueta, QR, DANFE, rastreio, pedido — o que vier."""
    ids = resolver(codigo)
    with Sessao() as s:
        devs = s.scalars(select(Devolucao).where(Devolucao.id.in_(ids))).all() if ids else []
        resultado = []
        for d in devs:
            conf = s.scalar(select(Conferencia).filter_by(devolucao_id=d.id))
            evid = s.scalars(select(Evidencia).filter_by(devolucao_id=d.id)).all()
            resultado.append({
                "devolucao": publico(d),
                "olist": _olist(d),
                "midia": _midia(d),
                "conferencia": conf and {**_colunas(conf), "evidencias_exigidas":
                                         EVIDENCIAS.get(d.plataforma, ["foto"])
                                         if conf.contestar or conf.chamado_manual else []},
                "evidencias": [_colunas(e) for e in evid],
            })
    return resultado


class Travada(Exception):
    """Ação que já aconteceu na Olist e não pode ser refeita nem alterada."""


def _custo_seguro(sku: str | None) -> float | None:
    try:
        return custo_do_sku(sku) if sku else None
    except RuntimeError:
        return None  # estoque fora do ar: a conferência segue, o prejuízo fica "sem custo"


def _sku_vendido(d: Devolucao) -> str | None:
    """SKU que a plataforma diz que foi vendido; se ela não informar, o do pedido na Olist."""
    if sku := next((i.get("sku") for i in d.itens if i.get("sku")), None):
        return sku
    try:
        return _produto_vendido(d)[1]
    except (RuntimeError, ValueError):
        return None


def enviar_para_chamado_manual(devolucao_id: int) -> None:
    """A contestação pela API falhou ou o operador decidiu: guarda para abrir o chamado à mão."""
    with Sessao.begin() as s:
        conf = s.scalar(select(Conferencia).filter_by(devolucao_id=devolucao_id))
        if not conf:
            raise LookupError(f"Devolução {devolucao_id} ainda não foi conferida")
        conf.chamado_manual, conf.contestar = True, False
        conf.motivo = "A contestação pela API não passou: fica na lista de chamados manuais com o prejuízo registrado."


def registrar_chamado_aberto(devolucao_id: int, protocolo: str | None, observacao: str | None) -> dict:
    with Sessao.begin() as s:
        conf = s.scalar(select(Conferencia).filter_by(devolucao_id=devolucao_id))
        if not conf or not conf.chamado_manual:
            raise LookupError(f"Devolução {devolucao_id} não tem chamado manual pendente")
        conf.chamado_aberto_em, conf.chamado_protocolo = _agora(), protocolo
        if observacao:
            conf.observacao = f"{conf.observacao or ''}\n[chamado] {observacao}".strip()
        return {"chamado_aberto_em": conf.chamado_aberto_em, "chamado_protocolo": protocolo}


def registrar(devolucao_id: int, dados: dict) -> dict:
    with Sessao.begin() as s:
        d = s.get(Devolucao, devolucao_id)
        if not d:
            raise LookupError(f"Devolução {devolucao_id} não existe")
        conf = s.scalar(select(Conferencia).filter_by(devolucao_id=d.id)) or Conferencia(devolucao_id=d.id)
        if conf.estoque_lancado_em or conf.estoque_resultado:
            raise Travada("Estoque já movimentado na Olist: a conferência não pode mais ser alterada.")
        quantidade = sum(i.get("quantidade") or 0 for i in d.itens) or 1
        decisao = decidir(publico(d), dados, _custo_seguro(_sku_vendido(d)), _custo_seguro(dados.get("sku_recebido")),
                          quantidade)
        for campo in CAMPOS:
            setattr(conf, campo, dados.get(campo))
        conf.classe, conf.lancamentos = decisao["classe"], decisao["lancamentos"]
        conf.contestar, conf.motivo = decisao["contestar"], decisao["motivo"]
        conf.chamado_manual = decisao["chamado_manual"]
        conf.perda_produto, conf.frete_reverso = decisao["perda_produto"], decisao["frete_reverso"]
        conf.conferida_em = _agora()
        s.add(conf)
        for lanc in decisao["lancamentos"]:
            lanc["deposito_olist"] = olist.deposito_id(lanc["deposito"], d.plataforma)
    return decisao


def _produto_vendido(d: Devolucao) -> tuple[int, str]:
    pedidos = _olist(d)
    if pedidos["erro"]:
        raise RuntimeError(pedidos["erro"])
    itens = [i for p in pedidos["pedidos"] for i in p["itens"]]
    skus = {i.get("sku") for i in d.itens}
    alvo = [i for i in itens if i["sku"] in skus] or itens
    if len(alvo) != 1:
        # ponytail: pedido com vários itens diferentes pede escolha do operador; tratar quando aparecer na prática.
        raise ValueError(f"Não consegui identificar qual item do pedido voltou ({len(alvo)} candidatos).")
    return alvo[0]["produto_id"], alvo[0]["sku"]


def _pedido_com_nota(d: Devolucao) -> dict:
    pedidos = [p for p in _olist(d)["pedidos"] if p.get("nota")]
    if len(pedidos) != 1:
        raise ValueError("Não achei uma única NF de venda na Olist para este pedido.")
    return pedidos[0]


def gerar_nota_devolucao(devolucao_id: int) -> dict:
    """Clique do operador: cria na Olist a NF de devolução do que voltou (fica Pendente até emitir)."""
    with Sessao() as s:
        d = s.get(Devolucao, devolucao_id)
        conf = d and s.scalar(select(Conferencia).filter_by(devolucao_id=d.id))
        if not conf:
            raise LookupError("Confira o produto antes de gerar a NF de devolução.")
        if conf.classe == "C" and not conf.erro_nosso:
            raise ValueError("O produto vendido não voltou (divergente): não há o que devolver na nota.")
        pedido = _pedido_com_nota(d)
        skus_nota = {i["sku"] for i in pedido["itens"]}
        voltou = {i["sku"]: i.get("quantidade") or 1 for i in d.itens if i.get("sku") in skus_nota}
        # Plataforma sem SKU (ou SKU diferente do da nota): com um item só na nota, é ele; com vários, não chuto.
        if not voltou and len(skus_nota) > 1:
            raise ValueError("Não consegui ligar os itens devolvidos aos itens da NF: gere pela Olist.")
        return olist.criar_nota_devolucao(pedido["nota"]["id"], voltou or None, d.pacote or d.pedido)


def emitir_nota_devolucao(devolucao_id: int) -> dict:
    with Sessao() as s:
        d = s.get(Devolucao, devolucao_id)
        if not d:
            raise LookupError(f"Devolução {devolucao_id} não existe")
        nota = _pedido_com_nota(d).get("nota_devolucao")
    if not nota:
        raise LookupError("Esta venda ainda não tem NF de devolução para emitir.")
    if nota["situacao"] != "Pendente":
        raise Travada(f"A NF de devolução {nota['numero']} já está {nota['situacao'].lower()}.")
    return olist.emitir_nota_devolucao(nota["id"])


def devolver_produto(devolucao_id: int) -> dict:
    """Um clique, como o "Devolver" da Olist: estoque no depósito que a conferência decidiu + NF de devolução
    criada e emitida. A NF vai pela API, que não relança estoque. Passo já feito é pulado: repetir continua."""
    with Sessao() as s:
        d = s.get(Devolucao, devolucao_id)
        conf = d and s.scalar(select(Conferencia).filter_by(devolucao_id=d.id))
        if not conf:
            raise LookupError("Confira o produto antes de devolver.")
        precisa_estoque = bool(conf.lancamentos) and not conf.estoque_lancado_em
        sem_nota = conf.classe == "C" and not conf.erro_nosso
    if precisa_estoque:
        falha = next((r for r in lancar_estoque(devolucao_id) if not r["ok"]), None)
        if falha:
            raise RuntimeError(f"Estoque não lançado: {falha['erro']}. Nenhuma nota foi gerada.")
    if sem_nota:
        return {"nota": "O produto vendido não voltou: não há nota de devolução."}
    with Sessao() as s:
        try:
            pedido = _pedido_com_nota(s.get(Devolucao, devolucao_id))
        except ValueError as e:
            raise ValueError(f"Estoque lançado, mas a NF de devolução não: {e}")
    if pedido["nota"]["situacao"] == "Cancelada":
        return {"nota": "A NF de venda foi cancelada: não precisa de nota de devolução."}
    nota = pedido.get("nota_devolucao")
    if nota and nota["situacao"] != "Pendente":
        return {"nota": f"NF de devolução {nota['numero']}: {nota['situacao'].lower()}."}
    try:
        if not nota:
            nota = gerar_nota_devolucao(devolucao_id)
        emitir_nota_devolucao(devolucao_id)
    except (ValueError, RuntimeError) as e:
        raise type(e)(f"Estoque lançado, mas a NF de devolução parou: {e}. Clique de novo para terminar.")
    return {"nota": f"NF de devolução {nota['numero']} enviada para a SEFAZ."}


def lancar_estoque(devolucao_id: int) -> list[dict]:
    """Executa na Olist os lançamentos decididos na conferência. Só roda por clique do operador."""
    with Sessao.begin() as s:
        d = s.get(Devolucao, devolucao_id)
        conf = d and s.scalar(select(Conferencia).filter_by(devolucao_id=d.id))
        if not conf:
            raise LookupError(f"Devolução {devolucao_id} ainda não foi conferida")
        if conf.estoque_lancado_em:
            raise Travada(f"Estoque já lançado em {conf.estoque_lancado_em:%d/%m/%Y %H:%M}.")
        anteriores = conf.estoque_resultado or []
        quantidade = sum(i.get("quantidade") or 0 for i in d.itens) or 1
        vendido = _produto_vendido(d) if any(l["sku"] == "vendido" for l in conf.lancamentos) else None
        recebido = None
        if any(l["sku"] == "recebido" for l in conf.lancamentos):
            pid = olist.produto_por_sku(conf.sku_recebido)
            if not pid:
                raise ValueError(f"SKU recebido {conf.sku_recebido!r} não existe na Olist.")
            recebido = (pid, conf.sku_recebido)

        resultado = []
        for n, lanc in enumerate(conf.lancamentos):
            if n < len(anteriores) and anteriores[n]["ok"]:
                resultado.append(anteriores[n])  # já feito numa tentativa anterior: não repetir
                continue
            produto_id, sku = vendido if lanc["sku"] == "vendido" else recebido
            item = {**lanc, "sku_olist": sku, "produto_id": produto_id, "quantidade": quantidade}
            # Kit lança por componente; os já lançados numa tentativa anterior não repetem.
            feitos = list(anteriores[n].get("feitos") or []) if n < len(anteriores) else []
            try:
                for pid, sku_peca, qtd in olist.pecas(produto_id, sku, quantidade):
                    if pid in feitos:
                        continue
                    olist.movimentar(pid, olist.deposito_id(lanc["deposito"], d.plataforma), lanc["tipo"],
                                     qtd, custo_do_sku(sku_peca),
                                     f"Central de Devoluções: {d.plataforma} {d.id_externo} (classe {conf.classe})")
                    feitos.append(pid)
                resultado.append({**item, "ok": True, "feitos": feitos})
            except RuntimeError as e:
                resultado.append({**item, "ok": False, "erro": str(e), "feitos": feitos})
                break
        conf.estoque_resultado = resultado
        if len(resultado) == len(conf.lancamentos) and all(r["ok"] for r in resultado):
            conf.estoque_lancado_em = _agora()
    return resultado


def salvar_evidencia(devolucao_id: int, content_type: str, conteudo: BinaryIO) -> dict:
    if content_type not in TIPOS:
        raise ValueError(f"Tipo não aceito: {content_type}. Envie foto (jpg/png/webp) ou vídeo (mp4/webm/mov).")
    tipo, ext = TIPOS[content_type]
    with Sessao() as s:
        if not s.get(Devolucao, devolucao_id):
            raise LookupError(f"Devolução {devolucao_id} não existe")
    pasta = PASTA / str(devolucao_id)
    pasta.mkdir(parents=True, exist_ok=True)
    nome = uuid.uuid4().hex + ext
    destino, tamanho = pasta / nome, 0
    with destino.open("wb") as f:
        while bloco := conteudo.read(2**20):
            tamanho += len(bloco)
            if tamanho > LIMITE[tipo]:
                f.close()
                destino.unlink()
                raise ValueError(f"{tipo} maior que {LIMITE[tipo] // 2**20} MB")
            f.write(bloco)
    with Sessao.begin() as s:
        ev = Evidencia(devolucao_id=devolucao_id, tipo=tipo, arquivo=nome, tamanho=tamanho, enviada_em=_agora())
        s.add(ev)
        s.flush()
        return _colunas(ev)


def arquivo_evidencia(evidencia_id: int) -> Path:
    with Sessao() as s:
        ev = s.get(Evidencia, evidencia_id)
        if not ev:
            raise LookupError(f"Evidência {evidencia_id} não existe")
        return PASTA / str(ev.devolucao_id) / ev.arquivo
