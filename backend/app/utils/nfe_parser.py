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
            root = ET.fromstring(file_content)

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

        except Exception as e:
            logger.error(f"Erro ao fazer parse do XML: {str(e)}")
            return {
                "sucesso": False,
                "erro": str(e),
                "itens": []
            }

    @staticmethod
    def parse_pdf_ocr(file_path: str) -> Dict:
        """
        Parse PDF using OCR (optional, phase 2)
        Requires pytesseract and poppler
        """
        try:
            from pdf2image import convert_from_path
            import pytesseract

            images = convert_from_path(file_path)
            texto_completo = ""

            for image in images:
                texto = pytesseract.image_to_string(image, lang='por')
                texto_completo += texto

            return {
                "sucesso": True,
                "texto": texto_completo,
                "requer_validacao_manual": True
            }

        except Exception as e:
            logger.error(f"Erro ao processar PDF com OCR: {str(e)}")
            return {
                "sucesso": False,
                "erro": str(e)
            }
