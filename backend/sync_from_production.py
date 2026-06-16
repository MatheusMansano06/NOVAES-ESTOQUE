import json
import shutil
import sqlite3
import urllib.request
from datetime import datetime
from pathlib import Path


BASE_URL = "https://novaes-estoque-production.up.railway.app"
BACKEND_DIR = Path(__file__).resolve().parent
DB_PATH = BACKEND_DIR / "estoque_virtual.db"
SEED_PATH = BACKEND_DIR / "seed.db"
BACKUP_DIR = BACKEND_DIR / "backups"


def fetch_json(path: str):
    with urllib.request.urlopen(BASE_URL + path, timeout=60) as response:
        return json.loads(response.read().decode("utf-8"))


def backup_file(path: Path):
    if not path.exists():
        return
    BACKUP_DIR.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(path, BACKUP_DIR / f"{path.stem}-{stamp}{path.suffix}.bak")


def infer_tipo_documento(arquivo_original: str) -> str:
    nome = (arquivo_original or "").lower()
    if nome.endswith(".pdf"):
        return "PDF"
    return "NFE"


def normalize_dt(value):
    if not value:
        return None
    return str(value).replace("T", " ")


def normalize_item_status(value):
    mapa = {
        "quarentena": "QUARENTENA",
        "confirmado": "CONFIRMADO",
        "bloqueado": "BLOQUEADO",
    }
    if value is None:
        return "QUARENTENA"
    return mapa.get(str(value).lower(), str(value))


def reset_tables(conn: sqlite3.Connection):
    tables = [
        "confirmacoes_estoque",
        "historico_compras",
        "notificacoes_fornecedores",
        "configuracoes_estoque_minimo",
        "fornecedores",
        "itens_embale_fu",
        "embaldes_fu",
        "itens_estoque",
        "notas_fiscais",
        "vinculos_olist",
        "apelidos_fornecedores",
        "precos_venda_produto",
        "anuncios",
    ]
    cur = conn.cursor()
    cur.execute("PRAGMA foreign_keys = OFF")
    for table in tables:
        cur.execute(f"DELETE FROM {table}")
    try:
        cur.execute("DELETE FROM sqlite_sequence")
    except sqlite3.OperationalError:
        pass
    conn.commit()


def sync_notes(conn: sqlite3.Connection, notes_payload: dict):
    cur = conn.cursor()
    fornecedores_por_nome = {}
    fornecedor_seq = 1

    for note in notes_payload["items"]:
        cur.execute(
            """
            INSERT INTO notas_fiscais
            (id, numero_nf, serie, fornecedor, cnpj, endereco, data_emissao, data_upload,
             arquivo_original, tipo_documento, xml_processado, status, erros, valor_frete)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                note["id"],
                note.get("numero_nf"),
                note.get("serie"),
                note.get("fornecedor"),
                note.get("cnpj"),
                note.get("endereco"),
                normalize_dt(note.get("data_emissao")),
                normalize_dt(note.get("data_upload")),
                note.get("arquivo_original"),
                infer_tipo_documento(note.get("arquivo_original", "")),
                None,
                note.get("status"),
                note.get("erros"),
                float(note.get("valor_frete") or 0),
            ),
        )

        fornecedor_nome = note.get("fornecedor") or ""
        if fornecedor_nome and fornecedor_nome not in fornecedores_por_nome:
            fornecedores_por_nome[fornecedor_nome] = fornecedor_seq
            cur.execute(
                """
                INSERT INTO fornecedores
                (id, nome, cnpj, endereco, criado_em, ativo)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (
                    fornecedor_seq,
                    fornecedor_nome,
                    note.get("cnpj"),
                    note.get("endereco"),
                    note.get("data_upload") or datetime.utcnow().isoformat(),
                    1,
                ),
            )
            fornecedor_seq += 1

        for item in note.get("itens") or []:
            cur.execute(
                """
                INSERT INTO itens_estoque
                (id, nf_id, codigo_produto, descricao, quantidade_nf, quantidade_confirmada,
                 preco_unitario, status, divergencia, data_criacao, olist_produto_id, olist_sku,
                 olist_nome, vinculado_em, estoque_olist_atualizado_em, quantidade_olist_enviada)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    note["id"],
                    item.get("codigo_produto"),
                    item.get("descricao"),
                    float(item.get("quantidade_nf") or 0),
                    None if item.get("quantidade_confirmada") is None else float(item.get("quantidade_confirmada") or 0),
                    float(item.get("preco_unitario") or 0),
                    normalize_item_status(item.get("status")),
                    item.get("divergencia"),
                    normalize_dt(item.get("data_criacao")),
                    item.get("olist_produto_id"),
                    item.get("olist_sku"),
                    item.get("olist_nome"),
                    normalize_dt(item.get("vinculado_em")),
                    normalize_dt(item.get("estoque_olist_atualizado_em")),
                    float(item.get("quantidade_olist_enviada") or 0),
                ),
            )

            qty_conf = item.get("quantidade_confirmada")
            if qty_conf is not None:
                cur.execute(
                    """
                    INSERT INTO confirmacoes_estoque
                    (item_estoque_id, quantidade_confirmada, divergencia, data_confirmacao, vinculado_olist, observacoes)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item["id"],
                        float(qty_conf or 0),
                        item.get("divergencia"),
                        normalize_dt(item.get("estoque_olist_atualizado_em") or item.get("vinculado_em") or item.get("data_criacao")),
                        item.get("olist_sku"),
                        "Sincronizado da produção",
                    ),
                )

                if fornecedor_nome in fornecedores_por_nome:
                    cur.execute(
                        """
                        INSERT INTO historico_compras
                        (fornecedor_id, nf_id, produto_codigo, produto_descricao, quantidade, data_compra, nf_numero)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            fornecedores_por_nome[fornecedor_nome],
                            note["id"],
                            item.get("codigo_produto"),
                            item.get("descricao"),
                            float(qty_conf or 0),
                            normalize_dt(note.get("data_emissao") or note.get("data_upload")),
                            note.get("numero_nf"),
                        ),
                    )

    conn.commit()


def sync_vinculos(conn: sqlite3.Connection, payload: dict):
    cur = conn.cursor()
    for vinc in payload.get("vinculos") or []:
        cur.execute(
            """
            INSERT INTO vinculos_olist
            (id, nf_codigo, nf_descricao, olist_produto_id, olist_sku, olist_nome,
             olist_preco, vezes_usado, criado_em, atualizado_em)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                vinc["id"],
                vinc.get("nf_codigo"),
                vinc.get("nf_descricao"),
                vinc.get("olist_produto_id"),
                vinc.get("olist_sku"),
                vinc.get("olist_nome"),
                float(vinc.get("olist_preco") or 0),
                int(vinc.get("vezes_usado") or 1),
                normalize_dt(vinc.get("criado_em")),
                normalize_dt(vinc.get("criado_em")),
            ),
        )
    conn.commit()


def sync_apelidos(conn: sqlite3.Connection, payload: dict):
    cur = conn.cursor()
    updated_at = payload.get("updated_at") or datetime.utcnow().isoformat()
    updated_at = normalize_dt(updated_at)
    for nome_fornecedor, apelido in (payload.get("apelidos") or {}).items():
        cur.execute(
            """
            INSERT INTO apelidos_fornecedores
            (nome_fornecedor, apelido, criado_em, atualizado_em)
            VALUES (?, ?, ?, ?)
            """,
            (nome_fornecedor, apelido, updated_at, updated_at),
        )
    conn.commit()


def sync_precos(conn: sqlite3.Connection, payload: dict):
    cur = conn.cursor()
    now = datetime.utcnow().isoformat()
    now = normalize_dt(now)
    for produto_chave, preco_venda in (payload.get("precos") or {}).items():
        cur.execute(
            """
            INSERT INTO precos_venda_produto
            (produto_chave, preco_venda, atualizado_em)
            VALUES (?, ?, ?)
            """,
            (produto_chave, float(preco_venda or 0), now),
        )
    conn.commit()


def sync_embaldes(conn: sqlite3.Connection):
    cur = conn.cursor()
    emb_list = fetch_json("/api/embaldes?limit=200")
    for emb in emb_list.get("items") or []:
        detail = fetch_json(f"/api/embaldes/{emb['id']}")
        arquivo_original = detail.get("arquivo_original")
        arquivo_uuid = f"sync-prod-{emb['id']}-{arquivo_original or 'arquivo'}"
        cur.execute(
            """
            INSERT INTO embaldes_fu
            (id, nome_embalde, numero_inbound, total_unidades, arquivo_original, arquivo_uuid,
             data_upload, data_limite, data_encerramento, status, observacoes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                emb["id"],
                detail.get("nome_embalde"),
                detail.get("numero_inbound"),
                float(detail.get("total_unidades") or 0),
                arquivo_original,
                arquivo_uuid[:255],
                normalize_dt(detail.get("data_upload")),
                normalize_dt(detail.get("data_limite")),
                normalize_dt(detail.get("data_encerramento")),
                detail.get("status"),
                "Sincronizado da produção",
            ),
        )

        for item in detail.get("itens") or []:
            cur.execute(
                """
                INSERT INTO itens_embale_fu
                (id, embalde_id, titulo_anuncio, quantidade_separada, sku_inbound, codigo_ml,
                 olist_produto_id, olist_sku, olist_nome, validado, validacao_mensagem,
                 data_validacao, criado_em)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    item["id"],
                    emb["id"],
                    item.get("titulo_anuncio"),
                    float(item.get("quantidade_separada") or 0),
                    item.get("sku_inbound"),
                    item.get("codigo_ml"),
                    item.get("olist_produto_id"),
                    item.get("olist_sku"),
                    item.get("olist_nome"),
                    int(item.get("validado") or 0),
                    item.get("validacao_mensagem"),
                    normalize_dt(detail.get("data_upload")),
                    normalize_dt(detail.get("data_upload")),
                ),
            )
    conn.commit()


def main():
    notes = fetch_json("/api/notas-fiscais")
    vinculos = fetch_json("/api/olist/vinculos")
    apelidos = fetch_json("/api/apelidos-fornecedores")
    precos = fetch_json("/api/precos-venda")

    backup_file(DB_PATH)
    backup_file(SEED_PATH)

    conn = sqlite3.connect(DB_PATH)
    try:
        reset_tables(conn)
        sync_notes(conn, notes)
        sync_vinculos(conn, vinculos)
        sync_apelidos(conn, apelidos)
        sync_precos(conn, precos)
        sync_embaldes(conn)
    finally:
        conn.close()

    shutil.copy2(DB_PATH, SEED_PATH)
    print(f"[SYNC] Banco local sincronizado com a produção: {DB_PATH}")
    print(f"[SYNC] Seed atualizado: {SEED_PATH}")


if __name__ == "__main__":
    main()
