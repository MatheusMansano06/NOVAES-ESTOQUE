"""NF de devolução (entrada) a partir da NF de venda, espelhando o que o recurso "devolução" da própria Olist gera:
tipo E, finalidade 4, natureza 732440565 (a Olist calcula CFOP e impostos por ela), mesmos itens e valores,
desconto proporcional, frete "sem ocorrência" e as três linhas de referência nas observações — é por elas que
o índice de notas de devolução liga a nota à venda."""

from datetime import date

NATUREZA_DEVOLUCAO = 732440565
FINALIDADE_DEVOLUCAO = 4


def _data_br(iso: str | None) -> str:
    return date.fromisoformat(iso[:10]).strftime("%d/%m/%Y") if iso else ""


def montar(venda: dict, devolvidos: dict[str, float] | None, hoje: date, pedido_marketplace: str | None) -> dict:
    """`devolvidos`: SKU → quantidade que voltou. None = devolução do pedido inteiro."""
    itens = []
    for i in venda.get("itens") or []:
        qtd = i["quantidade"] if devolvidos is None else min(devolvidos.get(i["codigo"], 0), i["quantidade"])
        if qtd > 0:
            itens.append({"item": {"codigo": i["codigo"], "descricao": i["descricao"], "unidade": i.get("unidade") or "UN",
                                   "quantidade": qtd, "valor_unitario": i["valorUnitario"], "tipo": "P",
                                   "ncm": i.get("ncm"), "origem": i.get("origem")}})
    if not itens:
        raise ValueError("Nenhum item da NF de venda corresponde ao que voltou.")

    total = sum(i["valorUnitario"] * i["quantidade"] for i in venda["itens"])
    devolvido = sum(i["item"]["valor_unitario"] * i["item"]["quantidade"] for i in itens)
    c = venda["cliente"]
    end = c.get("endereco") or {}
    return {"nota_fiscal": {
        "tipo": "E",
        "id_natureza_operacao": NATUREZA_DEVOLUCAO,
        "finalidade": FINALIDADE_DEVOLUCAO,
        "refNFe": venda["chaveAcesso"],
        "data_emissao": hoje.strftime("%d/%m/%Y"),
        "cliente": {
            "nome": c["nome"], "tipo_pessoa": c.get("tipoPessoa"), "cpf_cnpj": c.get("cpfCnpj"),
            "ie": c.get("inscricaoEstadual"), "endereco": end.get("endereco"), "numero": end.get("numero"),
            "complemento": end.get("complemento"), "bairro": end.get("bairro"), "cep": end.get("cep"),
            "cidade": end.get("municipio"), "uf": end.get("uf"), "fone": c.get("telefone"), "email": c.get("email"),
            "atualizar_cliente": "N",  # não mexe no cadastro do cliente
        },
        "itens": itens,
        "valor_desconto": round((venda.get("valorDesconto") or 0) * devolvido / total, 2) if total else 0,
        "frete_por_conta": "S",
        "numero_pedido_ecommerce": pedido_marketplace or "",
        "obs": (f"Número da NF-e referenciada: {int(venda['numero'])}\n"
                f"Data de emissão da NF-e referenciada: {_data_br(venda.get('dataEmissao'))}\n"
                f"Chave de acesso da NF-e referenciada: {venda['chaveAcesso']}"),
    }}
