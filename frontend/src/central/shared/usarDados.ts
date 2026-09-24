import { useEffect, useState } from "react";

import { api } from "./api";

/** GET que recarrega quando o caminho ou `versao` mudam; ignora respostas que chegam depois de trocar de tela. */
export function usarDados<T>(caminho: string, versao = 0) {
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    api.get<T>(caminho)
      .then((d) => { if (ativo) { setDados(d); setErro(null); } })
      .catch((e) => ativo && setErro((e as Error).message));
    return () => { ativo = false; };
  }, [caminho, versao]);

  return { dados, erro };
}
