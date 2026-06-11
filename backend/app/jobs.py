"""
Tarefas agendadas (Jobs) do sistema de estoque
- Verificação diária de estoque baixo às 8am
- Notificação automática de fornecedores
"""

from apscheduler.schedulers.background import BackgroundScheduler
from datetime import datetime
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
        scheduler.start()
        logger.info("[SCHEDULER] Agendador iniciado com sucesso")
        logger.info("[SCHEDULER] Job 'check_estoque_minimo' agendado para 08:00 todos os dias")
        logger.info("[SCHEDULER] Job 'encerrar_inbounds_vencidos' agendado a cada 1 hora")
