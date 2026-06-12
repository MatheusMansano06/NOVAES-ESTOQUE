import xml.etree.ElementTree as ET
from fpdf import FPDF
from typing import Dict, Optional
import io

class NFePDFGenerator:
    """Gera PDF a partir de dados extraídos de NF-e XML"""

    @staticmethod
    def gerar_pdf(xml_content: bytes) -> Optional[bytes]:
        """
        Converte um XML de NF-e para PDF formatado

        Args:
            xml_content: Conteúdo do arquivo XML em bytes

        Returns:
            Bytes do PDF gerado ou None se houver erro
        """
        try:
            # Parse XML
            root = ET.fromstring(xml_content)
            ns = {'nfe': 'http://www.portalfiscal.inf.br/nfe'}

            # Extrair dados principais
            ide = root.find('.//nfe:ide', ns)
            emit = root.find('.//nfe:emit', ns)
            dest = root.find('.//nfe:dest', ns)

            numero_nf = ide.find('nfe:nNF', ns).text if ide is not None else "N/A"
            serie = ide.find('nfe:serie', ns).text if ide is not None else "N/A"
            data_emissao = ide.find('nfe:dhEmi', ns).text if ide is not None else "N/A"

            fornecedor = emit.find('nfe:xNome', ns).text if emit is not None else "Desconhecido"
            cnpj_emit = emit.find('.//nfe:CNPJ', ns).text if emit is not None else ""

            dest_nome = dest.find('nfe:xNome', ns).text if dest is not None else "Desconhecido"

            # Extrair itens
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

            # Gerar PDF
            pdf = FPDF()
            pdf.add_page()
            pdf.set_font("Arial", "B", 16)
            pdf.cell(0, 10, "NOTA FISCAL ELETRONICA", 0, 1, "C")

            pdf.set_font("Arial", "", 10)
            pdf.ln(5)

            # Cabeçalho
            pdf.set_font("Arial", "B", 10)
            pdf.cell(0, 8, f"NF: {numero_nf} | Serie: {serie}", 0, 1)
            pdf.cell(0, 8, f"Data: {data_emissao[:10]}", 0, 1)

            # Emitente
            pdf.ln(5)
            pdf.set_font("Arial", "B", 10)
            pdf.cell(0, 8, "EMITENTE", 0, 1)
            pdf.set_font("Arial", "", 9)
            pdf.cell(0, 6, f"{fornecedor}", 0, 1)
            if cnpj_emit:
                pdf.cell(0, 6, f"CNPJ: {cnpj_emit}", 0, 1)

            # Destinatário
            pdf.ln(3)
            pdf.set_font("Arial", "B", 10)
            pdf.cell(0, 8, "DESTINATARIO", 0, 1)
            pdf.set_font("Arial", "", 9)
            pdf.cell(0, 6, f"{dest_nome}", 0, 1)

            # Itens
            pdf.ln(5)
            pdf.set_font("Arial", "B", 10)
            pdf.cell(0, 8, "PRODUTOS", 0, 1)

            pdf.set_font("Arial", "B", 9)
            pdf.cell(30, 7, "COD", 1)
            pdf.cell(80, 7, "DESCRICAO", 1)
            pdf.cell(30, 7, "QTD", 1)
            pdf.cell(25, 7, "PRECO", 1)
            pdf.ln()

            pdf.set_font("Arial", "", 8)
            for item in itens:
                # Limitar descrição para caber na célula
                desc = item["descricao"][:30]
                pdf.cell(30, 6, str(item["codigo"])[:8], 1)
                pdf.cell(80, 6, desc, 1)
                pdf.cell(30, 6, f"{item['quantidade']:.0f}", 1)
                pdf.cell(25, 6, f"R$ {item['preco']:.2f}", 1)
                pdf.ln()

            # Rodapé
            pdf.ln(5)
            pdf.set_font("Arial", "I", 8)
            pdf.cell(0, 5, f"Total de {len(itens)} item(ns)", 0, 1)
            pdf.cell(0, 5, "Gerado em: Estoque Virtual", 0, 1)

            # Gerar bytes
            pdf_bytes = pdf.output()
            return pdf_bytes

        except Exception as e:
            print(f"[ERRO] Ao gerar PDF da NF-e: {str(e)}")
            return None
