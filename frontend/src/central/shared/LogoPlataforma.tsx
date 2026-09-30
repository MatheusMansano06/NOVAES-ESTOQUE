import mlIcone from "../assets/logos/ml-icone.svg";
import shopeeIcone from "../assets/logos/shopee-icone.svg";
import { PLATAFORMA, type Plataforma } from "./devolucao";

// Ícones oficiais: ML = favicon do próprio site (http2.mlstatic.com); Shopee = sacola do logo na Wikimedia Commons.
const ICONE: Record<Plataforma, string> = { mercado_livre: mlIcone, shopee: shopeeIcone };

export function LogoPlataforma({ plataforma, tamanho = 22, comNome = false }:
  { plataforma: Plataforma; tamanho?: number; comNome?: boolean }) {
  return (
    <span className="logo-plataforma" title={PLATAFORMA[plataforma]}>
      <img src={ICONE[plataforma]} width={tamanho} height={tamanho} alt={comNome ? "" : PLATAFORMA[plataforma]} />
      {comNome && <span>{PLATAFORMA[plataforma]}</span>}
    </span>
  );
}
