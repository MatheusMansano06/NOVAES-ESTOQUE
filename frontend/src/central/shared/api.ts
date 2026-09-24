import { API_ORIGIN, buildOperadorHeaders } from "../../services/api";

/** Rotas da Central no backend do estoque. */
export const BASE_API = `${API_ORIGIN}/api/central`;

/** Única porta de saída do frontend para o backend. Erro vira mensagem legível do próprio backend. */
export class ErroApi extends Error {
  constructor(public status: number, mensagem: string) {
    super(mensagem);
  }
}

async function pedir<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${BASE_API}${caminho}`, { ...init, headers: { ...buildOperadorHeaders(), ...(init?.headers as Record<string, string> | undefined) } });
  const corpo = r.headers.get("content-type")?.includes("json") ? await r.json() : null;
  if (!r.ok) {
    const msg = corpo?.detail ?? corpo?.erro ?? `Falha ${r.status} ao chamar ${caminho}`;
    throw new ErroApi(r.status, typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return corpo as T;
}

export const api = {
  get: <T>(caminho: string) => pedir<T>(caminho),
  post: <T>(caminho: string, corpo?: unknown) =>
    pedir<T>(caminho, {
      method: "POST",
      headers: corpo === undefined ? undefined : { "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
  enviarArquivo: <T>(caminho: string, arquivo: File) => {
    const dados = new FormData();
    dados.append("arquivo", arquivo);
    return pedir<T>(caminho, { method: "POST", body: dados });
  },
};
