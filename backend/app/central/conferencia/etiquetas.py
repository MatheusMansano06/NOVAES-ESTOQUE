"""Transforma o que o leitor bipou em códigos candidatos. Etiqueta do ML traz de tudo: rastreio dos Correios,
rastreio interno do Mercado Envios, número do envio no código de barras, JSON no QR code, chave da DANFE,
URL da SEFAZ. E o leitor, se estiver com o layout de teclado errado, troca aspas e dois-pontos por outros
caracteres e quebra o JSON — por isso as sequências numéricas longas sempre entram como candidatas."""

import json
import re
from urllib.parse import parse_qsl, urlparse

CHAVE_NFE = re.compile(r"\d{44}")
NUMEROS = re.compile(r"\d{8,}")
PALAVRAS = re.compile(r"[A-Za-z0-9]{8,}")
# Prefixo de simbologia que alguns leitores mandam antes do código (ex.: "]C1" em Code 128).
SIMBOLOGIA = re.compile(r"^\][A-Za-z]\d")


def _valores(dado) -> list[str]:
    if isinstance(dado, dict):
        return [v for x in dado.values() for v in _valores(x)]
    if isinstance(dado, list):
        return [v for x in dado for v in _valores(x)]
    return [str(dado)] if dado not in (None, "") else []


def extrair(bruto: str) -> list[str]:
    texto = SIMBOLOGIA.sub("", bruto.strip())
    candidatos = [texto]
    try:
        candidatos += _valores(json.loads(texto))  # QR do ML: {"id":"<envio>","t":"lm", ...}
    except (ValueError, TypeError):
        pass
    if texto.lower().startswith(("http://", "https://")):
        url = urlparse(texto)
        candidatos += [v for _, v in parse_qsl(url.query)] + url.path.split("/")
        # QR da NFC-e/SEFAZ: p=<chave>|2|1|...
        candidatos += [p for v in dict(parse_qsl(url.query)).values() for p in v.split("|")]
    candidatos += CHAVE_NFE.findall(texto) + NUMEROS.findall(texto) + PALAVRAS.findall(texto)
    vistos, saida = set(), []
    for c in (c.strip() for c in candidatos):
        if len(c) >= 6 and c.upper() not in vistos:
            vistos.add(c.upper())
            saida.append(c)
    return saida
