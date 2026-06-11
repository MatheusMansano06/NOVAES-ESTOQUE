"""
Gera PDF com diagramas VISUAIS de fluxo do Estoque Virtual
"""

from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import cm
from reportlab.lib.colors import HexColor, black, white
from datetime import datetime
import math

def draw_box(c, x, y, width, height, text, color, text_color=white):
    """Desenha caixa com texto"""
    c.setFillColor(color)
    c.setStrokeColor(black)
    c.setLineWidth(2)
    c.rect(x, y, width, height, fill=1)

    c.setFillColor(text_color)
    c.setFont("Helvetica-Bold", 10)
    lines = text.split('\n')
    line_height = 12
    start_y = y + height/2 + (len(lines)-1) * line_height / 2
    for i, line in enumerate(lines):
        c.drawCentredString(x + width/2, start_y - i*line_height, line)

def draw_cylinder(c, x, y, width, height, text, color, text_color=white):
    """Desenha cilindro (database)"""
    c.setFillColor(color)
    c.setStrokeColor(black)
    c.setLineWidth(2)

    # Base do cilindro
    c.ellipse(x, y, x+width, y+height*0.2, fill=1)
    # Corpo
    c.rect(x, y+height*0.1, width, height*0.8, fill=1)
    # Topo
    c.ellipse(x, y+height*0.8, x+width, y+height, fill=1, stroke=1)

    c.setFillColor(text_color)
    c.setFont("Helvetica-Bold", 9)
    c.drawCentredString(x + width/2, y + height/2, text)

def draw_arrow(c, x1, y1, x2, y2, label=""):
    """Desenha seta entre dois pontos"""
    c.setStrokeColor(black)
    c.setLineWidth(2)
    c.line(x1, y1, x2, y2)

    # Ponta da seta
    angle = math.atan2(y2-y1, x2-x1)
    arrow_size = 0.5*cm
    ax = x2 - arrow_size * math.cos(angle)
    ay = y2 - arrow_size * math.sin(angle)
    c.line(x2, y2, ax - arrow_size/3 * math.sin(angle), ay + arrow_size/3 * math.cos(angle))
    c.line(x2, y2, ax + arrow_size/3 * math.sin(angle), ay - arrow_size/3 * math.cos(angle))

    if label:
        c.setFont("Helvetica", 8)
        c.drawString(x1 + (x2-x1)/2 + 0.2*cm, y1 + (y2-y1)/2 + 0.2*cm, label)

def draw_diamond(c, x, y, size, text, color, text_color=white):
    """Desenha losango (decisão)"""
    # Usar Path para desenhar o losango
    from reportlab.graphics.shapes import Path

    p = Path()
    p.moveTo(x + size/2, y + size)  # topo
    p.lineTo(x + size, y + size/2)  # direita
    p.lineTo(x + size/2, y)         # baixo
    p.lineTo(x, y + size/2)         # esquerda
    p.closePath()

    # Desenhar retângulo em vez de losango (mais simples)
    c.setFillColor(color)
    c.setStrokeColor(black)
    c.setLineWidth(2)
    c.rect(x, y, size, size, fill=1)

    c.setFillColor(text_color)
    c.setFont("Helvetica-Bold", 8)
    lines = text.split('\n')
    for i, line in enumerate(lines):
        c.drawCentredString(x + size/2, y + size/2 + (len(lines)-1-i)*7, line)

def create_visual_pdf():
    """Cria PDF com diagramas visuais"""
    c = canvas.Canvas("fluxograma_estoque_virtual.pdf", pagesize=landscape(A4))
    width, height = landscape(A4)

    # Cores
    COLOR_UPLOAD = HexColor('#e74c3c')  # vermelho
    COLOR_PROCESS = HexColor('#3498db')  # azul
    COLOR_DB = HexColor('#2ecc71')  # verde
    COLOR_FRONTEND = HexColor('#9b59b6')  # roxo
    COLOR_EXTERNAL = HexColor('#f39c12')  # laranja
    COLOR_DECISION = HexColor('#e67e22')  # laranja escuro

    # ===== PÁGINA 1: VISÃO GERAL =====
    c.setFont("Helvetica-Bold", 24)
    c.drawCentredString(width/2, height - 1*cm, "ESTOQUE VIRTUAL - DIAGRAMA DO SISTEMA")

    c.setFont("Helvetica", 10)
    c.drawString(1*cm, height - 1.5*cm, f"Data: {datetime.now().strftime('%d/%m/%Y')} | Versão: 1.0")

    # Desenho principal
    margin_top = height - 2.5*cm
    box_width = 2*cm
    box_height = 1.2*cm
    spacing_x = 3*cm
    spacing_y = 2.5*cm

    # Linha 1: Entrada
    x1 = 1*cm
    y1 = margin_top
    draw_box(c, x1, y1, box_width, box_height, "USUARIO\nFAZ UPLOAD", COLOR_UPLOAD)

    # Seta para parser
    x2 = x1 + box_width + 0.5*cm
    y2 = y1 + box_height/2
    draw_arrow(c, x1 + box_width, y2, x2, y2, "XML/PDF")

    # Parser
    x3 = x2 + 0.5*cm
    draw_box(c, x3, y1, box_width, box_height, "PARSER\nnfelib/OCR", COLOR_PROCESS)

    # Seta para DB
    x4 = x3 + box_width + 0.5*cm
    y4 = y1 + box_height/2
    draw_arrow(c, x3 + box_width, y4, x4, y4, "Dados")

    # Database
    x5 = x4 + 0.5*cm
    draw_cylinder(c, x5, y1 - 0.3*cm, box_width, box_height + 0.6*cm, "SQLite\nEstoque", COLOR_DB)

    # Linha 2: Processamento
    y_line2 = y1 - spacing_y

    # Frontend
    x_fe = 1*cm
    draw_box(c, x_fe, y_line2, box_width, box_height, "FRONTEND\nReact TS", COLOR_FRONTEND)

    # Seta do DB para Frontend
    draw_arrow(c, x5 + box_width/2, y1, x_fe + box_width/2, y_line2 + box_height, "API")

    # Confirmação
    x_conf = x_fe + spacing_x
    draw_box(c, x_conf, y_line2, box_width, box_height, "CONFIRMACAO\nFISICA", COLOR_DECISION)

    # Seta Frontend -> Confirmação
    draw_arrow(c, x_fe + box_width, y_line2 + box_height/2, x_conf, y_line2 + box_height/2)

    # Linha 3: Vinculação Olist
    y_line3 = y_line2 - spacing_y

    # Fuzzy Match
    x_fuzzy = 1*cm
    draw_box(c, x_fuzzy, y_line3, box_width, box_height, "FUZZY\nMATCH", COLOR_PROCESS)
    draw_arrow(c, x_conf + box_width/2, y_line2, x_fuzzy + box_width/2, y_line3 + box_height, "SKU")

    # Cache
    x_cache = x_fuzzy + spacing_x
    draw_box(c, x_cache, y_line3, box_width, box_height, "CACHE\n30min", COLOR_PROCESS)
    draw_arrow(c, x_fuzzy + box_width, y_line3 + box_height/2, x_cache, y_line3 + box_height/2)

    # Olist API
    x_olist = x_cache + spacing_x
    draw_box(c, x_olist, y_line3, box_width, box_height, "OLIST API\nOAuth2", COLOR_EXTERNAL)
    draw_arrow(c, x_cache + box_width, y_line3 + box_height/2, x_olist, y_line3 + box_height/2, "Fallback")

    # Stock Sync
    x_sync = x_olist + spacing_x
    draw_box(c, x_sync, y_line3, box_width, box_height, "SYNC\nESTOQUE", COLOR_EXTERNAL)
    draw_arrow(c, x_olist + box_width, y_line3 + box_height/2, x_sync, y_line3 + box_height/2)

    # Seta de volta pro DB
    draw_arrow(c, x_sync + box_width/2, y_line3, x5 + box_width/2, y1, "Update")

    # Legenda
    y_legend = y_line3 - 1.5*cm
    c.setFont("Helvetica-Bold", 10)
    c.drawString(1*cm, y_legend, "LEGENDA:")

    legend_y = y_legend - 0.4*cm
    draw_box(c, 1*cm, legend_y - 0.3*cm, 0.6*cm, 0.4*cm, "", COLOR_UPLOAD)
    c.setFont("Helvetica", 9)
    c.drawString(1.8*cm, legend_y - 0.1*cm, "Entrada do Usuário")

    draw_box(c, 3.5*cm, legend_y - 0.3*cm, 0.6*cm, 0.4*cm, "", COLOR_PROCESS)
    c.drawString(4.3*cm, legend_y - 0.1*cm, "Processamento")

    draw_cylinder(c, 5.8*cm, legend_y - 0.5*cm, 0.6*cm, 0.5*cm, "", COLOR_DB)
    c.drawString(6.6*cm, legend_y - 0.1*cm, "Banco de Dados")

    draw_box(c, 8.2*cm, legend_y - 0.3*cm, 0.6*cm, 0.4*cm, "", COLOR_FRONTEND)
    c.drawString(9*cm, legend_y - 0.1*cm, "Interface Usuário")

    draw_box(c, 10.5*cm, legend_y - 0.3*cm, 0.6*cm, 0.4*cm, "", COLOR_EXTERNAL)
    c.drawString(11.3*cm, legend_y - 0.1*cm, "Sistema Externo")

    # Info box
    c.setLineWidth(1)
    c.setStrokeColor(black)
    c.rect(1*cm, 0.5*cm, width - 2*cm, 1.5*cm, fill=0)

    c.setFont("Helvetica-Bold", 9)
    c.drawString(1.3*cm, 1.8*cm, "FLUXO PRINCIPAL:")
    c.setFont("Helvetica", 8)
    c.drawString(1.3*cm, 1.5*cm, "1. Usuário faz upload (XML/PDF) → 2. Parser extrai dados → 3. Estoque virtual criado")
    c.drawString(1.3*cm, 1.2*cm, "4. Frontend mostra itens para confirmação → 5. Fuzzy match com Olist → 6. Cache & Sync")
    c.drawString(1.3*cm, 0.9*cm, "7. Banco atualizado com estoque confirmado → 8. Notificações automáticas (WhatsApp)")
    c.drawString(1.3*cm, 0.6*cm, "Status: quarentena → confirmado → bloqueado | 40+ endpoints | 8 tabelas | 9 segurança fixes")

    c.showPage()

    # ===== PÁGINA 2: FLUXO DETALHADO 1 (UPLOAD) =====
    c.setFont("Helvetica-Bold", 20)
    c.drawString(1*cm, height - 1*cm, "FLUXO 1: UPLOAD E PARSING DE NF-E")

    y_start = height - 2*cm
    box_w = 2.2*cm
    box_h = 1*cm
    step_y = 2*cm

    # Passo 1
    draw_box(c, 1*cm, y_start, box_w, box_h, "1. UPLOAD\nArquivo", COLOR_UPLOAD)
    draw_arrow(c, 1*cm + box_w, y_start + box_h/2, 1*cm + box_w + 0.5*cm, y_start + box_h/2)

    # Passo 2
    x = 1*cm + box_w + 1*cm
    draw_box(c, x, y_start, box_w, box_h, "2. VALIDACAO\nMIME/Tamanho", COLOR_PROCESS)
    draw_arrow(c, x + box_w, y_start + box_h/2, x + box_w + 0.5*cm, y_start + box_h/2)

    # Passo 3
    x = x + box_w + 1*cm
    draw_box(c, x, y_start, box_w, box_h, "3. UUID\nRENAME", COLOR_PROCESS)
    draw_arrow(c, x + box_w/2, y_start, x + box_w/2, y_start - 1.2*cm)

    # Passo 4
    y = y_start - 1.5*cm
    draw_box(c, 1*cm, y, box_w, box_h, "4. PARSE XML\nnfelib", COLOR_PROCESS)
    draw_arrow(c, 1*cm + box_w, y + box_h/2, 1*cm + box_w + 0.5*cm, y + box_h/2)

    # Passo 5
    x = 1*cm + box_w + 1*cm
    draw_diamond(c, x, y - 0.2*cm, 1.8*cm, "PDF?", COLOR_DECISION)

    # Sim -> OCR
    draw_arrow(c, x + 1.8*cm, y + 0.3*cm, x + 3*cm, y + 0.3*cm, "Sim")
    draw_box(c, x + 3*cm, y, box_w, box_h, "5. OCR\npytesseract", COLOR_PROCESS)

    # Não -> continua
    draw_arrow(c, x + 0.9*cm, y - 0.2*cm, x + 0.9*cm, y - 1.2*cm, "Não")

    # Passo 6
    y = y - 1.5*cm
    draw_box(c, 1*cm, y, box_w, box_h, "6. EXTRAIR\nITENS", COLOR_PROCESS)
    draw_arrow(c, 1*cm + box_w, y + box_h/2, 1*cm + box_w + 0.5*cm, y + box_h/2)

    # Passo 7
    x = 1*cm + box_w + 1*cm
    draw_box(c, x, y, box_w, box_h, "7. INSERT\nBD", COLOR_DB)
    draw_arrow(c, x + box_w, y + box_h/2, x + box_w + 0.5*cm, y + box_h/2)

    # Passo 8
    x = x + box_w + 1*cm
    draw_box(c, x, y, box_w, box_h, "8. RESPONSE\n200 OK", COLOR_PROCESS)

    # Info
    c.setFont("Helvetica-Bold", 9)
    c.drawString(1*cm, y - 1*cm, "DETALHES:")
    c.setFont("Helvetica", 8)
    c.drawString(1*cm, y - 1.4*cm, "• Sanitizacao: UUID + realpath validation (previne path traversal)")
    c.drawString(1*cm, y - 1.8*cm, "• Validacao: max 10MB, extensoes .xml/.pdf apenas")
    c.drawString(1*cm, y - 2.2*cm, "• Transacao: INSERT atomico com rollback se erro")
    c.drawString(1*cm, y - 2.6*cm, "• Resultado: NotaFiscal criada + ItemEstoque com status=quarentena")

    c.showPage()

    # ===== PÁGINA 3: FLUXO DETALHADO 2 (CONFIRMACAO) =====
    c.setFont("Helvetica-Bold", 20)
    c.drawString(1*cm, height - 1*cm, "FLUXO 2: CONFIRMACAO DE ESTOQUE")

    y_start = height - 2*cm

    # Passo 1
    draw_box(c, 1*cm, y_start, box_w, box_h, "1. EXIBIR\nITENS", COLOR_FRONTEND)
    draw_arrow(c, 1*cm + box_w, y_start + box_h/2, 1*cm + box_w + 0.5*cm, y_start + box_h/2)

    # Passo 2
    x = 1*cm + box_w + 1*cm
    draw_box(c, x, y_start, box_w, box_h, "2. CONFERENCIA\nFISICA", COLOR_DECISION)
    draw_arrow(c, x + box_w, y_start + box_h/2, x + box_w + 0.5*cm, y_start + box_h/2)

    # Passo 3
    x = x + box_w + 1*cm
    draw_box(c, x, y_start, box_w, box_h, "3. INFORMAR\nQTY", COLOR_FRONTEND)
    draw_arrow(c, x + box_w/2, y_start, x + box_w/2, y_start - 1.2*cm)

    # Passo 4
    y = y_start - 1.5*cm
    draw_box(c, 1*cm, y, box_w, box_h, "4. POST\n/confirmar-estoque", COLOR_PROCESS)
    draw_arrow(c, 1*cm + box_w, y + box_h/2, 1*cm + box_w + 0.5*cm, y + box_h/2)

    # Passo 5 - Decisão
    x = 1*cm + box_w + 1*cm
    draw_diamond(c, x, y - 0.2*cm, 1.8*cm, "Qtd OK?", COLOR_DECISION)

    # Sim
    draw_arrow(c, x + 1.8*cm, y + 0.3*cm, x + 3*cm, y + 0.3*cm, "Sim")
    draw_box(c, x + 3*cm, y, box_w, box_h, "5a. STATUS:\nconfirmado", COLOR_DB)

    # Não
    draw_arrow(c, x + 0.9*cm, y - 0.2*cm, x + 0.9*cm, y - 1.2*cm, "Não")
    draw_box(c, 1*cm, y - 1.5*cm, box_w, box_h, "5b. REGISTRAR\nDIVERGENCIA", COLOR_DECISION)

    # Resultado
    y = y - 1.5*cm
    x = 1*cm + box_w + 1*cm
    draw_box(c, x, y, box_w, box_h, "6. INSERT\nConfirmacao", COLOR_DB)

    draw_arrow(c, x + box_w, y + box_h/2, x + box_w + 0.5*cm, y + box_h/2)
    x = x + box_w + 1*cm
    draw_box(c, x, y, box_w, box_h, "7. RESPONSE\nOK", COLOR_PROCESS)

    # Info
    c.setFont("Helvetica-Bold", 9)
    c.drawString(1*cm, y - 1*cm, "DETALHES:")
    c.setFont("Helvetica", 8)
    c.drawString(1*cm, y - 1.4*cm, "• Status: quarentena → confirmado (ou com divergencia registrada)")
    c.drawString(1*cm, y - 1.8*cm, "• Divergencia: motivo + data + usuario rastreado em tabela separada")
    c.drawString(1*cm, y - 2.2*cm, "• Auditoria: ConfirmacaoEstoque cria registro de cada confirmacao")
    c.drawString(1*cm, y - 2.6*cm, "• Resolucao: endpoint /resolver-divergencia marca como resolvida")

    c.showPage()

    # ===== PÁGINA 4: FLUXO DETALHADO 3 (OLIST) =====
    c.setFont("Helvetica-Bold", 20)
    c.drawString(1*cm, height - 1*cm, "FLUXO 3: VINCULACAO COM OLIST")

    y_start = height - 2*cm

    # Passo 1
    draw_box(c, 1*cm, y_start, box_w, box_h, "1. OLIST\nCONECTAR", COLOR_EXTERNAL)
    draw_arrow(c, 1*cm + box_w, y_start + box_h/2, 1*cm + box_w + 0.5*cm, y_start + box_h/2, "OAuth2")

    # Passo 2
    x = 1*cm + box_w + 1*cm
    draw_box(c, x, y_start, box_w, box_h, "2. AUTH\nCODE", COLOR_PROCESS)
    draw_arrow(c, x + box_w, y_start + box_h/2, x + box_w + 0.5*cm, y_start + box_h/2)

    # Passo 3
    x = x + box_w + 1*cm
    draw_box(c, x, y_start, box_w, box_h, "3. TOKEN\n0o600", COLOR_DB)
    draw_arrow(c, x + box_w/2, y_start, x + box_w/2, y_start - 1.2*cm)

    # Passo 4
    y = y_start - 1.5*cm
    draw_box(c, 1*cm, y, box_w, box_h, "4. BUSCAR\nPRODUTOS", COLOR_PROCESS)
    draw_arrow(c, 1*cm + box_w, y + box_h/2, 1*cm + box_w + 0.5*cm, y + box_h/2)

    # Passo 5 - Decisão
    x = 1*cm + box_w + 1*cm
    draw_diamond(c, x, y - 0.2*cm, 1.8*cm, "Cache\nVálido?", COLOR_DECISION)

    # Sim
    draw_arrow(c, x + 1.8*cm, y + 0.3*cm, x + 3*cm, y + 0.3*cm, "Sim")
    draw_box(c, x + 3*cm, y, box_w, box_h, "5a. USE\nCACHE", COLOR_PROCESS)

    # Não -> API
    draw_arrow(c, x + 0.9*cm, y - 0.2*cm, x + 0.9*cm, y - 1.2*cm, "Não")
    draw_box(c, 1*cm, y - 1.5*cm, box_w, box_h, "5b. CALL\nOLIST API", COLOR_EXTERNAL)

    # Passo 6
    y = y - 1.5*cm
    x = 1*cm + box_w + 1*cm
    draw_diamond(c, x, y - 0.2*cm, 1.8*cm, "Kit?", COLOR_DECISION)

    # Sim
    draw_arrow(c, x + 1.8*cm, y + 0.3*cm, x + 3*cm, y + 0.3*cm, "Sim")
    draw_box(c, x + 3*cm, y, box_w, box_h, "6a. DECOMP\nCOMPOSICAO", COLOR_PROCESS)

    # Não
    draw_arrow(c, x + 0.9*cm, y - 0.2*cm, x + 0.9*cm, y - 1.2*cm, "Não")

    # Passo 7 - Fuzzy Match
    y = y - 1.5*cm
    draw_box(c, 1*cm, y, box_w, box_h, "7. FUZZY\nMATCH", COLOR_PROCESS)
    draw_arrow(c, 1*cm + box_w, y + box_h/2, 1*cm + box_w + 0.5*cm, y + box_h/2)

    # Passo 8
    x = 1*cm + box_w + 1*cm
    draw_box(c, x, y, box_w, box_h, "8. VINCULAR\nOLIST", COLOR_DB)
    draw_arrow(c, x + box_w, y + box_h/2, x + box_w + 0.5*cm, y + box_h/2)

    # Passo 9
    x = x + box_w + 1*cm
    draw_box(c, x, y, box_w, box_h, "9. SYNC\nESTOQUE", COLOR_EXTERNAL)

    # Info
    c.setFont("Helvetica-Bold", 9)
    c.drawString(1*cm, y - 1*cm, "DETALHES:")
    c.setFont("Helvetica", 8)
    c.drawString(1*cm, y - 1.4*cm, "• Cache: 30 minutos com fallback API (instantaneo vs 60s)")
    c.drawString(1*cm, y - 1.8*cm, "• Kit Detection: decomposicao automatica de kits em componentes")
    c.drawString(1*cm, y - 2.2*cm, "• Fuzzy Match: SQL LIKE + fuzzywuzzy com confianca 60-100%")
    c.drawString(1*cm, y - 2.6*cm, "• VinculoOlist: tabela de memoria vendor→marketplace + aceitar sugestao manual")

    c.showPage()

    # ===== PÁGINA 5: MODELO DE DADOS =====
    c.setFont("Helvetica-Bold", 20)
    c.drawString(1*cm, height - 1*cm, "MODELO DE DADOS - 8 TABELAS")

    y_pos = height - 2*cm

    # NotaFiscal
    c.setFont("Helvetica-Bold", 10)
    c.drawString(1*cm, y_pos, "NotaFiscal")
    c.setStrokeColor(COLOR_HEADER := HexColor('#1a1a2e'))
    c.setLineWidth(1)
    c.rect(1*cm, y_pos - 1.5*cm, 3*cm, 1.3*cm)
    c.setFont("Helvetica", 8)
    c.drawString(1.2*cm, y_pos - 0.3*cm, "id (PK)")
    c.drawString(1.2*cm, y_pos - 0.6*cm, "numero_nf")
    c.drawString(1.2*cm, y_pos - 0.9*cm, "fornecedor")
    c.drawString(1.2*cm, y_pos - 1.2*cm, "data_emissao, status")

    # Seta
    draw_arrow(c, 4*cm, y_pos - 0.75*cm, 4.5*cm, y_pos - 0.75*cm)

    # ItemEstoque
    c.setFont("Helvetica-Bold", 10)
    c.drawString(4.7*cm, y_pos, "ItemEstoque")
    c.rect(4.7*cm, y_pos - 1.5*cm, 3*cm, 1.3*cm)
    c.setFont("Helvetica", 8)
    c.drawString(4.9*cm, y_pos - 0.3*cm, "id (PK), nf_id (FK)")
    c.drawString(4.9*cm, y_pos - 0.6*cm, "codigo_produto (SKU)")
    c.drawString(4.9*cm, y_pos - 0.9*cm, "qtd_nf, qtd_confirmada")
    c.drawString(4.9*cm, y_pos - 1.2*cm, "status (quarentena/conf/block)")

    # Seta
    draw_arrow(c, 7.7*cm, y_pos - 0.75*cm, 8.2*cm, y_pos - 0.75*cm)

    # ConfirmacaoEstoque
    c.setFont("Helvetica-Bold", 10)
    c.drawString(8.4*cm, y_pos, "ConfirmacaoEstoque")
    c.rect(8.4*cm, y_pos - 1.5*cm, 3.2*cm, 1.3*cm)
    c.setFont("Helvetica", 8)
    c.drawString(8.6*cm, y_pos - 0.3*cm, "id (PK), item_id (FK)")
    c.drawString(8.6*cm, y_pos - 0.6*cm, "qtd_confirmada")
    c.drawString(8.6*cm, y_pos - 0.9*cm, "usuario, data_confirmacao")
    c.drawString(8.6*cm, y_pos - 1.2*cm, "notas (audit)")

    # Segunda linha
    y_pos = y_pos - 2.2*cm

    # Divergencia
    c.setFont("Helvetica-Bold", 10)
    c.drawString(1*cm, y_pos, "Divergencia")
    c.rect(1*cm, y_pos - 1.5*cm, 3*cm, 1.3*cm)
    c.setFont("Helvetica", 8)
    c.drawString(1.2*cm, y_pos - 0.3*cm, "id (PK), item_id (FK)")
    c.drawString(1.2*cm, y_pos - 0.6*cm, "qtd_esperada vs recebida")
    c.drawString(1.2*cm, y_pos - 0.9*cm, "motivo, resolvida")
    c.drawString(1.2*cm, y_pos - 1.2*cm, "data")

    # Seta
    draw_arrow(c, 4*cm, y_pos - 0.75*cm, 4.5*cm, y_pos - 0.75*cm)

    # VinculoOlist
    c.setFont("Helvetica-Bold", 10)
    c.drawString(4.7*cm, y_pos, "VinculoOlist")
    c.rect(4.7*cm, y_pos - 1.5*cm, 3*cm, 1.3*cm)
    c.setFont("Helvetica", 8)
    c.drawString(4.9*cm, y_pos - 0.3*cm, "id (PK)")
    c.drawString(4.9*cm, y_pos - 0.6*cm, "sku_vendor → sku_olist")
    c.drawString(4.9*cm, y_pos - 0.9*cm, "produto_id_olist")
    c.drawString(4.9*cm, y_pos - 1.2*cm, "confianca (60-100%)")

    # Seta
    draw_arrow(c, 7.7*cm, y_pos - 0.75*cm, 8.2*cm, y_pos - 0.75*cm)

    # Fornecedor
    c.setFont("Helvetica-Bold", 10)
    c.drawString(8.4*cm, y_pos, "Fornecedor")
    c.rect(8.4*cm, y_pos - 1.5*cm, 3.2*cm, 1.3*cm)
    c.setFont("Helvetica", 8)
    c.drawString(8.6*cm, y_pos - 0.3*cm, "id (PK)")
    c.drawString(8.6*cm, y_pos - 0.6*cm, "nome, cnpj, email")
    c.drawString(8.6*cm, y_pos - 0.9*cm, "whatsapp, uf")
    c.drawString(8.6*cm, y_pos - 1.2*cm, "data_criacao")

    # Info
    y_pos = y_pos - 2*cm
    c.setFont("Helvetica-Bold", 9)
    c.drawString(1*cm, y_pos, "STATUS ITEM: quarentena (novo) → confirmado (verificado) → bloqueado (erro)")
    c.setFont("Helvetica", 8)
    c.drawString(1*cm, y_pos - 0.4*cm, "RELACIONAMENTOS: NotaFiscal 1→N ItemEstoque → Divergencia + ConfirmacaoEstoque")
    c.drawString(1*cm, y_pos - 0.8*cm, "AUDITORIA: Cada confirmacao, divergencia e vinculos registrados com timestamp + usuario")

    c.showPage()

    # Salvar
    c.save()
    print("[OK] PDF visual gerado com sucesso!")

if __name__ == "__main__":
    create_visual_pdf()
