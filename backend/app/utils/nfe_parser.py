import xml.etree.ElementTree as ET
from typing import Dict, Optional
from datetime import datetime
import logging
import json

logger = logging.getLogger(__name__)

class NFeParsing:
    """Parse NF-e XML files to extract products and quantities"""

    @staticmethod
    def parse_datetime(iso_string: Optional[str]) -> Optional[datetime]:
        """Convert ISO 8601 datetime string to Python datetime object"""
        if not iso_string:
            return None
        try:
            # Handle ISO format with timezone (e.g., 2024-06-02T10:30:00-03:00)
            if '+' in iso_string or iso_string.count('-') > 2:
                # Remove timezone info for SQLite compatibility
                if 'T' in iso_string:
                    dt_part = iso_string.split('+')[0].split('-')[:-1]
                    # This is a bit tricky, let's use a simpler approach
                    return datetime.fromisoformat(iso_string.replace('Z', '+00:00')[:19])
            return datetime.fromisoformat(iso_string[:19])
        except:
            return None

    @staticmethod
    def parse_xml(file_content: bytes) -> Dict:
        """
        Parse NF-e XML and extract relevant information

        Returns:
            {
                "numero_nf": str,
                "serie": str,
                "data_emissao": str,
                "fornecedor": str,
                "itens": [
                    {"codigo": str, "descricao": str, "quantidade": float, "preco": float}
                ]
            }
        """
        try:
            # 0) Conteúdo vazio/corrompido: causa #1 de "no element found".
            #    Dá um diagnóstico preciso em vez de uma mensagem genérica.
            if not file_content or not file_content.strip():
                tamanho = len(file_content or b"")
                return {
                    "sucesso": False,
                    "erro": (f"O arquivo enviado está vazio ({tamanho} bytes). "
                             "O download do XML provavelmente falhou ou veio incompleto. "
                             "Baixe novamente o XML da nota direto do emissor/SEFAZ e tente de novo."),
                    "itens": []
                }

            # 1) Remove BOM (UTF-8/UTF-16) e espaços antes da declaração <?xml,
            #    que quebram o parser ("declaration not at start of entity").
            limpo = file_content
            for bom in (b"\xef\xbb\xbf", b"\xff\xfe", b"\xfe\xff"):
                if limpo.startswith(bom):
                    limpo = limpo[len(bom):]
                    break
            limpo = limpo.lstrip()

            # 2) Detecta arquivos que NÃO são XML (erro comum: mandar o DANFE/PDF).
            cabecalho = limpo[:64].lstrip().lower()
            if cabecalho.startswith(b"%pdf"):
                return {
                    "sucesso": False,
                    "erro": ("Este arquivo é um PDF (DANFE), não o XML da nota. "
                             "Envie o arquivo .xml de verdade — ou suba o PDF na opção de PDF."),
                    "itens": []
                }
            if cabecalho.startswith(b"<!doctype html") or cabecalho.startswith(b"<html"):
                return {
                    "sucesso": False,
                    "erro": ("Este arquivo é uma página HTML, não o XML da nota. "
                             "Provavelmente o download trouxe uma página de erro/login. "
                             "Baixe novamente o XML direto do emissor/SEFAZ."),
                    "itens": []
                }

            try:
                root = ET.fromstring(limpo)
            except ET.ParseError:
                # 3) Fallback de encoding: alguns emissores salvam em UTF-16 ou
                #    declaram um encoding que não bate com os bytes. Tenta decodificar
                #    e reserializar para o parser resolver pela árvore de texto.
                texto = None
                for enc in ("utf-8", "utf-16", "latin-1"):
                    try:
                        texto = limpo.decode(enc)
                        break
                    except (UnicodeDecodeError, LookupError):
                        continue
                if texto is None:
                    raise
                # Remove a declaração de encoding p/ o ET não reclamar de divergência
                import re as _re
                texto = _re.sub(r'<\?xml[^>]*\?>', '', texto, count=1).lstrip()
                root = ET.fromstring(texto)

            # Namespaces for NF-e
            ns = {
                'nfe': 'http://www.portalfiscal.inf.br/nfe',
            }

            # Extract header info
            ide = root.find('.//nfe:ide', ns)
            emit = root.find('.//nfe:emit', ns)

            numero_nf = ide.find('nfe:nNF', ns).text if ide is not None else "N/A"
            serie = ide.find('nfe:serie', ns).text if ide is not None else "1"
            data_emissao_str = ide.find('nfe:dhEmi', ns).text if ide is not None else None
            data_emissao = NFeParsing.parse_datetime(data_emissao_str)
            fornecedor = emit.find('nfe:xNome', ns).text if emit is not None else "Desconhecido"

            # CNPJ do emitente (fornecedor)
            cnpj = ""
            if emit is not None:
                cnpj_el = emit.find('nfe:CNPJ', ns)
                cpf_el = emit.find('nfe:CPF', ns)
                if cnpj_el is not None and cnpj_el.text:
                    cnpj = cnpj_el.text
                elif cpf_el is not None and cpf_el.text:
                    cnpj = cpf_el.text

            # Endereço do emitente
            endereco = ""
            if emit is not None:
                ender = emit.find('nfe:enderEmit', ns)
                if ender is not None:
                    def _t(tag):
                        el = ender.find(f'nfe:{tag}', ns)
                        return el.text if el is not None and el.text else ""
                    partes = [_t('xLgr'), _t('nro'), _t('xBairro'), _t('xMun'), _t('UF')]
                    endereco = ", ".join([p for p in partes if p])

            # Extract items
            itens = []
            for det in root.findall('.//nfe:det', ns):
                prod = det.find('nfe:prod', ns)
                if prod is not None:
                    item = {
                        "codigo": prod.find('nfe:cProd', ns).text if prod.find('nfe:cProd', ns) is not None else "",
                        "descricao": prod.find('nfe:xProd', ns).text if prod.find('nfe:xProd', ns) is not None else "",
                        "quantidade": float(prod.find('nfe:qCom', ns).text) if prod.find('nfe:qCom', ns) is not None else 0.0,
                        "preco": float(prod.find('nfe:vUnCom', ns).text) if prod.find('nfe:vUnCom', ns) is not None else 0.0,
                    }
                    itens.append(item)

            return {
                "numero_nf": numero_nf,
                "serie": serie,
                "data_emissao": data_emissao,
                "fornecedor": fornecedor,
                "cnpj": cnpj,
                "endereco": endereco,
                "itens": itens,
                "sucesso": True
            }

        except ET.ParseError as e:
            logger.error(f"Erro ao fazer parse do XML: {str(e)}")
            tecnico = str(e)
            tamanho = len(file_content or b"")
            if "no element found" in tecnico or "column 0" in tecnico:
                amigavel = (f"O arquivo XML está vazio ou não é uma NF-e válida ({tamanho} bytes recebidos). "
                            "Baixe novamente o XML da nota (o arquivo .xml de verdade, "
                            "não o DANFE/PDF) e tente de novo.")
            else:
                amigavel = ("Não consegui ler este XML de NF-e. Verifique se é o arquivo "
                            f"XML correto da nota. (detalhe: {tecnico})")
            return {"sucesso": False, "erro": amigavel, "itens": []}
        except Exception as e:
            logger.error(f"Erro ao fazer parse do XML: {str(e)}")
            return {
                "sucesso": False,
                "erro": f"Erro ao processar o XML da NF-e: {str(e)}",
                "itens": []
            }

    @staticmethod
    def parse_pdf_ocr(file_path: str) -> Dict:
        """
        Parse PDF using OCR + pdfplumber para extrair dados estruturados
        Tenta primeiro extrair texto com pdfplumber, depois OCR se necessário
        """
        import os
        import re
        from datetime import datetime

        try:
            tamanho_mb = os.path.getsize(file_path) / (1024 * 1024)
            if tamanho_mb > 50:
                return {
                    "sucesso": False,
                    "erro": f"PDF muito grande ({tamanho_mb:.1f}MB). Máximo: 50MB.",
                    "itens": []
                }

            try:
                import pdfplumber
            except ImportError:
                return {
                    "sucesso": False,
                    "erro": "pdfplumber não instalado. Execute: pip install pdfplumber",
                    "itens": []
                }

            texto_completo = ""

            # Tentar extrair texto com pdfplumber (mais rápido, sem OCR)
            try:
                with pdfplumber.open(file_path) as pdf:
                    for page in pdf.pages:
                        texto_completo += page.extract_text() or ""
            except Exception as e:
                logger.warning(f"pdfplumber falhou, tentando OCR: {e}")
                texto_completo = ""

            # Se pdfplumber não extraiu nada, usar OCR
            if not texto_completo or len(texto_completo.strip()) < 100:
                try:
                    from pdf2image import convert_from_path
                    import pytesseract

                    images = convert_from_path(file_path, first_page=1, last_page=min(30, len(open(file_path, 'rb').read()) // 10000))
                    for image in images:
                        texto_completo += pytesseract.image_to_string(image, lang='por') + "\n"
                except ImportError:
                    return {
                        "sucesso": False,
                        "erro": "Dependências OCR não instaladas. Execute: pip install pdf2image pytesseract",
                        "itens": []
                    }
                except Exception as e:
                    logger.error(f"OCR falhou: {e}")
                    return {
                        "sucesso": False,
                        "erro": f"Falha ao processar PDF com OCR: {str(e)}",
                        "itens": []
                    }

            if not texto_completo or len(texto_completo.strip()) < 50:
                return {
                    "sucesso": False,
                    "erro": "Não foi possível extrair texto do PDF. Verifique se é um PDF válido.",
                    "itens": []
                }

            # Parse dos dados estruturados do texto extraído
            return NFeParsing._extrair_dados_nfe_texto(texto_completo)

        except Exception as e:
            logger.error(f"Erro ao processar PDF: {str(e)}")
            return {
                "sucesso": False,
                "erro": f"Erro ao processar PDF: {str(e)}",
                "itens": []
            }

    @staticmethod
    def _extrair_dados_nfe_texto(texto: str) -> Dict:
        """
        Extrai dados estruturados de NF a partir de texto (de PDF ou OCR)
        Busca padrões comuns em notas fiscais eletrônicas
        """
        import re
        from datetime import datetime

        try:
            # Normalizar texto
            texto_limpo = texto.upper()

            # Extrair número da NF (padrão: NF nº 123456 ou NF-e nº 123456 ou NF 123456)
            match_nf = re.search(r'NF[- ]?E?\s*(?:nº|numero|n[\°º]?)\s*:?\s*(\d{6,})', texto_limpo)
            numero_nf = match_nf.group(1) if match_nf else ""

            # Série (padrão: Série 1 ou S: 1)
            match_serie = re.search(r'(?:SÉRIE|S[\s:]?)\s*:?\s*(\d{1,3})', texto_limpo)
            serie = match_serie.group(1) if match_serie else "1"

            # Data (padrão: 01/01/2024 ou 2024-01-01)
            match_data = re.search(r'(\d{1,2})[/-](\d{1,2})[/-](\d{4})', texto)
            data_emissao = None
            if match_data:
                try:
                    dia, mes, ano = match_data.groups()
                    data_emissao = datetime(int(ano), int(mes), int(dia))
                except:
                    pass

            # CNPJ/CPF (padrão: 12.345.678/0001-99)
            match_cnpj = re.search(r'(\d{2})[.\s]?(\d{3})[.\s]?(\d{3})[.\s]?([0-9]{4})[/-]?(\d{2})', texto)
            cnpj = "".join(match_cnpj.groups()) if match_cnpj else ""

            # Fornecedor (palavra após EMITENTE/FORNECEDOR)
            match_fornecedor = re.search(r'(?:EMITENTE|FORNECEDOR|RAZÃO SOCIAL)[:\s]*([A-Z\s0-9]{5,80})', texto_limpo)
            fornecedor = match_fornecedor.group(1).strip() if match_fornecedor else "Fornecedor Desconhecido"

            # Endereço (buscar padrão de rua, número, cidade)
            match_endereco = re.search(r'(?:RUA|AV\.|AVENIDA|TRAVESSA)\s+([A-Z\s0-9,\-\.]{10,100})', texto_limpo)
            endereco = match_endereco.group(1).strip() if match_endereco else ""

            # Itens: buscar padrões como "Descrição | Qtd | Preço"
            # Procura por linhas com números de quantidade e preço
            itens = []

            # Padrão 1: Linhas com quantidade e preço unitário
            padrao_item = r'([A-Z0-9\s\-\/]{10,100}?)\s+(\d+[,.]?\d*)\s+(?:UN|PC|KG|MT|L)?\s+(?:R\$\s*)?(\d+[,.]?\d{2})'
            for match in re.finditer(padrao_item, texto_limpo):
                try:
                    descricao = match.group(1).strip()
                    quantidade = float(match.group(2).replace(',', '.'))
                    preco = float(match.group(3).replace(',', '.'))

                    if quantidade > 0 and preco > 0 and len(descricao) > 3:
                        itens.append({
                            "codigo": f"PDF-{len(itens)+1:03d}",  # Código temporal
                            "descricao": descricao[:100],
                            "quantidade": quantidade,
                            "preco": preco
                        })
                except (ValueError, AttributeError):
                    continue

            # Se não encontrou itens com padrão regex, tentar padrão mais simples
            if not itens:
                linhas = texto.split('\n')
                for linha in linhas:
                    # Procura linhas que parecem ser itens (texto + números)
                    if len(linha) > 10 and any(char.isdigit() for char in linha):
                        # Tenta extrair números da linha
                        numeros = re.findall(r'\d+[,.]?\d*', linha)
                        if len(numeros) >= 2:  # Mínimo: quantidade e preço
                            try:
                                descricao = re.sub(r'\d+[,.]?\d*', '', linha).strip()
                                if descricao and len(descricao) > 3:
                                    quantidade = float(numeros[0].replace(',', '.'))
                                    preco = float(numeros[-1].replace(',', '.'))

                                    if quantidade > 0 and preco > 0 and len(descricao) < 150:
                                        itens.append({
                                            "codigo": f"PDF-{len(itens)+1:03d}",
                                            "descricao": descricao[:100],
                                            "quantidade": quantidade,
                                            "preco": preco
                                        })
                                        if len(itens) >= 100:  # Limitar a 100 itens
                                            break
                            except (ValueError, IndexError):
                                continue

            # Validação mínima
            if not numero_nf:
                return {
                    "sucesso": False,
                    "erro": "Não foi possível extrair o número da NF do PDF. Verifique se o arquivo é uma nota fiscal válida.",
                    "itens": []
                }

            return {
                "numero_nf": numero_nf,
                "serie": serie,
                "data_emissao": data_emissao.isoformat() if data_emissao else datetime.now().isoformat(),
                "fornecedor": fornecedor,
                "cnpj": cnpj,
                "endereco": endereco,
                "itens": itens,
                "sucesso": True,
                "aviso": "Dados extraídos via OCR - validar manualmente" if len(itens) < 5 else None
            }

        except Exception as e:
            logger.error(f"Erro ao extrair dados de NF do texto: {str(e)}")
            return {
                "sucesso": False,
                "erro": f"Erro ao processar dados da NF: {str(e)}",
                "itens": []
            }
