"""
Tarefas agendadas (Jobs) do sistema de estoque
- Verificação diária de estoque baixo às 8am
- Notificação automática de fornecedores
"""

from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
import os
import logging
from database import SessionLocal
from app.models import (
    ItemEstoque, StatusEstoque, ConfiguracaoEstoqueMinimo,
    HistoricoCompra, Fornecedor, NotificacaoFornecedor, EmbaleFU
)
import urllib.parse

logger = logging.getLogger(__name__)
scheduler = BackgroundScheduler()


def encerrar_inbounds_vencidos():
    """
    Tarefa: encerra automaticamente inbounds cuja data limite já passou.
    Inbounds encerrados param de descontar do estoque na conferência.
    Roda periodicamente.
    """
    db = SessionLocal()
    try:
        agora = datetime.utcnow()
        vencidos = db.query(EmbaleFU).filter(
            EmbaleFU.status == "processando",
            EmbaleFU.data_limite != None,
            EmbaleFU.data_limite <= agora
        ).all()

        if not vencidos:
            return

        for inbound in vencidos:
            inbound.status = "encerrado"
            inbound.data_encerramento = agora
            logger.info(f"[JOB] Inbound #{inbound.numero_inbound} (id={inbound.id}) encerrado automaticamente (data limite vencida)")

        db.commit()
        logger.info(f"[JOB] {len(vencidos)} inbound(s) encerrado(s) automaticamente")

    except Exception as e:
        db.rollback()
        logger.error(f"[JOB] Erro ao encerrar inbounds vencidos: {str(e)}")
    finally:
        db.close()


def verificar_e_notificar_fornecedores():
    """
    Tarefa diária: verificar estoque baixo e notificar fornecedores
    Roda automaticamente às 8am
    """
    db = SessionLocal()
    try:
        logger.info("[JOB] Iniciando verificação de estoque e notificação de fornecedores")

        # Encontrar todos os produtos com estoque abaixo do mínimo
        produtos_baixos = []

        configs = db.query(ConfiguracaoEstoqueMinimo).filter(
            ConfiguracaoEstoqueMinimo.notificar_fornecedores == 1
        ).all()

        for config in configs:
            # Somar todas as quantidades confirmadas deste produto
            total_estoque = db.query(ItemEstoque).filter(
                ItemEstoque.codigo_produto == config.produto_codigo,
                ItemEstoque.status == StatusEstoque.CONFIRMADO
            ).all()

            quantidade_total = sum(item.quantidade_confirmada or 0 for item in total_estoque)

            if quantidade_total <= config.estoque_minimo:
                produtos_baixos.append({
                    "produto_codigo": config.produto_codigo,
                    "estoque_minimo": config.estoque_minimo,
                    "quantidade_atual": quantidade_total,
                    "itens": total_estoque
                })

        if not produtos_baixos:
            logger.info("[JOB] Nenhum produto com estoque baixo encontrado")
            return

        logger.info(f"[JOB] {len(produtos_baixos)} produto(s) com estoque baixo detectado(s)")

        notificacoes_enviadas = 0

        # Para cada produto com estoque baixo, notificar os fornecedores
        for produto in produtos_baixos:
            codigo = produto["produto_codigo"]

            # Obter descrição do produto
            item = produto["itens"][0] if produto["itens"] else None
            descricao = item.descricao if item else codigo

            # Buscar fornecedores que já forneceram este produto
            historico = db.query(HistoricoCompra).filter(
                HistoricoCompra.produto_codigo == codigo
            ).distinct(HistoricoCompra.fornecedor_id).all()

            fornecedor_ids = [h.fornecedor_id for h in historico]

            if not fornecedor_ids:
                continue

            fornecedores = db.query(Fornecedor).filter(
                Fornecedor.id.in_(fornecedor_ids),
                Fornecedor.ativo == 1,
                Fornecedor.contato_whatsapp != None
            ).all()

            for fornecedor in fornecedores:
                # Verificar se já foi notificado hoje
                hoje = datetime.utcnow().date()
                ja_notificado = db.query(NotificacaoFornecedor).filter(
                    NotificacaoFornecedor.fornecedor_id == fornecedor.id,
                    NotificacaoFornecedor.produto_codigo == codigo,
                    NotificacaoFornecedor.status == "enviado"
                ).first()

                # Se já foi notificado hoje, pula
                if ja_notificado and ja_notificado.enviado_em.date() == hoje:
                    logger.info(f"[JOB] Fornecedor {fornecedor.nome} já notificado hoje sobre {codigo}")
                    continue

                # Construir mensagem
                mensagem = f"""📦 ALERTA DE ESTOQUE BAIXO - Estoque Virtual

Produto: {descricao}
Código: {codigo}
Estoque Atual: {produto['quantidade_atual']} un
Estoque Mínimo: {produto['estoque_minimo']} un

Você já forneceu este produto anteriormente.
Favor entrar em contato para recompra.

Obrigado!"""

                # Gerar WhatsApp link (para auditoria)
                telefone = fornecedor.contato_whatsapp
                mensagem_encoded = urllib.parse.quote(mensagem)
                whatsapp_link = f"https://wa.me/{telefone}?text={mensagem_encoded}"

                # Registrar notificação no banco
                notif = NotificacaoFornecedor(
                    fornecedor_id=fornecedor.id,
                    produto_codigo=codigo,
                    produto_descricao=descricao,
                    quantidade_atual=produto['quantidade_atual'],
                    estoque_minimo=produto['estoque_minimo'],
                    mensagem=mensagem,
                    telefone_usado=telefone,
                    status="enviado"
                )

                db.add(notif)
                notificacoes_enviadas += 1

                logger.info(f"[JOB] Notificação registrada: {fornecedor.nome} ({telefone}) - {codigo}")

        db.commit()
        logger.info(f"[JOB] Verificação concluída. {notificacoes_enviadas} notificação(ões) registrada(s)")

    except Exception as e:
        db.rollback()
        logger.error(f"[JOB] Erro ao verificar estoque: {str(e)}")
    finally:
        db.close()


def sincronizar_anuncios_ml():
    """
    Polling incremental do Mercado Livre: espelha o catálogo no cache local,
    buscando o detalhe SÓ dos anúncios que mudaram (compara last_updated).
    Assim a aba Anúncios serve do SQLite e só fala com a API quando o ML muda.
    """
    try:
        from app.integracoes_ml import ml
    except Exception as e:
        logger.error(f"[JOB][ML] import falhou: {e}")
        return

    if not ml.user_id or not ml.get_access_token():
        # sem credenciais/autorização: nada a sincronizar
        return

    try:
        resultado = ml.sync_catalogo(status="active")
        if resultado.get("skipped"):
            return
        if resultado.get("erro"):
            logger.error(f"[JOB][ML] sync falhou: {resultado.get('erro')}")
        else:
            logger.info(
                f"[JOB][ML] catálogo sincronizado: total={resultado.get('total')} "
                f"atualizados={resultado.get('atualizados')} ({resultado.get('modo')})"
            )
    except Exception as e:
        logger.error(f"[JOB][ML] erro inesperado: {e}")

    # Baixa automática de embalagens conforme o crescimento de vendas (nunca derruba o sync).
    try:
        from app.utils.embalagens import processar_baixas_embalagem
        from database import SessionLocal
        db = SessionLocal()
        try:
            resumo = processar_baixas_embalagem(db)
            if resumo.get("processados"):
                logger.info(f"[JOB][EMB] baixas: {resumo}")
        finally:
            db.close()
    except Exception as e:
        logger.error(f"[JOB][EMB] baixa de embalagens falhou: {e}")


def sincronizar_vendas_ml():
    """
    Atualiza o espelho de vendas do Mercado Livre (ml_venda_cache) de forma
    incremental — puxa os pedidos novos desde o último sync. Roda nos horários
    fixos do dia (03/08/12/17/22h). A tela de "Vendas do anúncio" lê do banco,
    então só depende deste job para ficar em dia (abertura instantânea).
    """
    try:
        from app.integracoes_ml import ml
    except Exception as e:
        logger.error(f"[JOB][VENDAS] import falhou: {e}")
        return

    if not ml.user_id or not ml.get_access_token():
        return

    try:
        resultado = ml.sync_vendas(incremental=True)
        if resultado.get("erro"):
            logger.error(f"[JOB][VENDAS] sync falhou: {resultado.get('erro')}")
        else:
            logger.info(
                f"[JOB][VENDAS] vendas sincronizadas: novos={resultado.get('novos')} "
                f"vistos={resultado.get('vistos')}"
            )
    except Exception as e:
        logger.error(f"[JOB][VENDAS] erro inesperado: {e}")


def iniciar_scheduler():
    """
    Inicia o scheduler com a tarefa diária às 8am
    Deve ser chamado no startup da aplicação
    """
    if not scheduler.running:
        # Agendar verificação diária às 08:00
        scheduler.add_job(
            verificar_e_notificar_fornecedores,
            'cron',
            hour=8,
            minute=0,
            id='check_estoque_minimo',
            name='Verificação de Estoque Baixo e Notificação de Fornecedores'
        )
        # Encerrar inbounds vencidos a cada hora
        scheduler.add_job(
            encerrar_inbounds_vencidos,
            'interval',
            hours=1,
            id='encerrar_inbounds_vencidos',
            name='Encerramento automático de inbounds vencidos'
        )
        # Polling incremental do Mercado Livre (intervalo configurável; roda já no boot)
        try:
            ml_intervalo = max(2, int(os.getenv("ML_POLL_INTERVAL_MINUTES", "10")))
        except (TypeError, ValueError):
            ml_intervalo = 10
        scheduler.add_job(
            sincronizar_anuncios_ml,
            'interval',
            minutes=ml_intervalo,
            id='ml_sync_catalogo',
            name='Sincronização incremental de anúncios do Mercado Livre',
            max_instances=1,
            coalesce=True,
            misfire_grace_time=3600,
        )
        # Sincronização de vendas do ML nos horários fixos (fuso de São Paulo).
        # Sem timezone explícito rodaria no fuso do servidor (UTC no Railway).
        tz_vendas = os.getenv("ML_VENDAS_TZ", "America/Sao_Paulo")
        try:
            scheduler.add_job(
                sincronizar_vendas_ml,
                'cron',
                hour='3,8,12,17,22',
                minute=0,
                timezone=tz_vendas,
                id='ml_sync_vendas',
                name='Sincronização de vendas do Mercado Livre (03/08/12/17/22h)',
                max_instances=1,
                coalesce=True,
                misfire_grace_time=3600,
            )
        except Exception as e:
            # Fallback sem timezone caso o fuso não esteja disponível no ambiente.
            logger.error(f"[SCHEDULER] Timezone '{tz_vendas}' indisponível ({e}); usando fuso do servidor")
            scheduler.add_job(
                sincronizar_vendas_ml, 'cron', hour='3,8,12,17,22', minute=0,
                id='ml_sync_vendas', name='Sincronização de vendas do Mercado Livre',
                max_instances=1, coalesce=True, misfire_grace_time=3600,
            )

        scheduler.start()
        logger.info("[SCHEDULER] Agendador iniciado com sucesso")
        logger.info("[SCHEDULER] Job 'check_estoque_minimo' agendado para 08:00 todos os dias")
        logger.info("[SCHEDULER] Job 'encerrar_inbounds_vencidos' agendado a cada 1 hora")
        logger.info(f"[SCHEDULER] Job 'ml_sync_catalogo' agendado a cada {ml_intervalo} min")
        logger.info(f"[SCHEDULER] Job 'ml_sync_vendas' agendado para 03/08/12/17/22h ({tz_vendas})")

        # Aquece o cache logo no boot, sem depender de next_run_time (que sofre
        # misfire) e sem bloquear o startup: dispara o sync numa thread daemon.
        try:
            from app.integracoes_ml import ml
            ml._sync_catalogo_async("active")
            logger.info("[SCHEDULER] Sync inicial de anúncios ML disparado em background")
        except Exception as e:
            logger.error(f"[SCHEDULER] Falha ao disparar sync inicial ML: {e}")

        # Aquece o espelho de vendas no boot SE estiver vazio (1ª carga = histórico
        # completo). Em background daemon, sem bloquear o startup. Depois, o job
        # agendado mantém em dia e a tela abre instantânea lendo do banco.
        try:
            import threading
            from app.models import MercadoLivreSyncState

            def _warm_vendas():
                try:
                    from app.integracoes_ml import ml as _ml
                    if not _ml.user_id or not _ml.get_access_token():
                        return
                    db = SessionLocal()
                    try:
                        ja = db.query(MercadoLivreSyncState).filter(
                            MercadoLivreSyncState.scope == _ml.VENDAS_SYNC_SCOPE
                        ).first()
                    finally:
                        db.close()
                    if ja is not None:
                        return  # já foi populado alguma vez; deixa pro job agendado
                    logger.info("[SCHEDULER] Espelho de vendas vazio — 1ª carga (histórico) em background")
                    r = _ml.sync_vendas(incremental=True)
                    logger.info(f"[SCHEDULER] 1ª carga de vendas concluída: {r}")
                except Exception as e:
                    logger.error(f"[SCHEDULER] Falha na 1ª carga de vendas: {e}")

            threading.Thread(target=_warm_vendas, name="warm-vendas", daemon=True).start()
        except Exception as e:
            logger.error(f"[SCHEDULER] Falha ao disparar 1ª carga de vendas: {e}")
