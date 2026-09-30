const moeda = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const data = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export const reais = (v: number | null | undefined) => (v == null ? "—" : moeda.format(v));

/** Datas do backend vêm em UTC sem fuso; o "Z" faz o navegador converter para o horário local. */
export const quando = (iso: string | null | undefined) => (iso ? data.format(new Date(`${iso}Z`)) : "—");

export function prazoRestante(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const horas = Math.round((new Date(`${iso}Z`).getTime() - Date.now()) / 36e5);
  if (horas < 0) return "prazo vencido";
  return horas < 48 ? `${horas} h restantes` : `${Math.round(horas / 24)} dias restantes`;
}
