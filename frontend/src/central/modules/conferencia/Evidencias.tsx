import { useEffect, useRef, useState, type ChangeEvent } from "react";

import { api, BASE_API } from "../../shared/api";
import type { Evidencia } from "./tipos";

interface Props {
  devolucaoId: number;
  evidencias: Evidencia[];
  exigidas: string[];
  onEnviada: () => void;
}

/** Foto de celular pesa 3-8 MB; para prova de disputa 1600px em JPEG 75% basta e fica em ~250 KB. */
async function reduzir(f: File): Promise<File> {
  if (!f.type.startsWith("image/")) return f;
  try {
    const img = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(img.width, img.height));
    const tela = document.createElement("canvas");
    tela.width = Math.round(img.width * k);
    tela.height = Math.round(img.height * k);
    tela.getContext("2d")!.drawImage(img, 0, 0, tela.width, tela.height);
    const b = await new Promise<Blob | null>((ok) => tela.toBlob(ok, "image/jpeg", 0.75));
    return b && b.size < f.size ? new File([b], "foto.jpg", { type: "image/jpeg" }) : f;
  } catch {
    return f; // formato que o navegador não decodifica: sobe o original
  }
}

/** Celular: câmera nativa pelo input. Computador: webcam ao vivo para foto e vídeo. */
export function Evidencias({ devolucaoId, evidencias, exigidas, onEnviada }: Props) {
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [webcam, setWebcam] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);

  async function enviar(original: File) {
    setErro(null);
    setFeito(null);
    setEnviando(true);
    try {
      const arquivo = await reduzir(original);
      await api.enviarArquivo(`/conferencia/${devolucaoId}/evidencias`, arquivo);
      setFeito(arquivo.type.startsWith("video/") ? "Vídeo gravado" : "Foto tirada");
      onEnviada();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setEnviando(false);
    }
  }

  function escolher(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    e.target.value = "";
    if (arquivo) void enviar(arquivo);
  }

  const tem = (tipo: string) => evidencias.some((ev) => ev.tipo === tipo);
  const pendentes = exigidas.filter((t) => !tem(t));

  return (
    <section className="evidencias" aria-labelledby="t-evidencias">
      <h3 id="t-evidencias">Fotos e vídeo</h3>
      {pendentes.length > 0 && (
        <p className="aviso forte">Para contestar ou abrir o chamado falta: {pendentes.map((t) => (t === "video" ? "vídeo" : "foto")).join(" e ")}.</p>
      )}
      <div className="acoes-evidencia">
        <label className="botao">
          Tirar foto
          <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={escolher} hidden />
        </label>
        <label className="botao">
          Gravar vídeo
          <input type="file" accept="video/mp4,video/webm,video/quicktime" capture="environment" onChange={escolher} hidden />
        </label>
        <button type="button" className="botao" onClick={() => setWebcam(true)}>Usar webcam</button>
      </div>
      {enviando && <p className="sub">Enviando arquivo…</p>}
      {feito && !enviando && <p className="aviso ok" role="status">✓ {feito}. Pode tirar outra se precisar.</p>}
      {erro && <p className="aviso erro" role="alert">{erro}</p>}
      {evidencias.length > 0 && (
        <ul className="miniaturas">
          {evidencias.map((ev) => (
            <li key={ev.id}>
              <a href={`${BASE_API}/conferencia/evidencias/${ev.id}`} target="_blank" rel="noreferrer">
                {ev.tipo === "foto"
                  ? <img src={`${BASE_API}/conferencia/evidencias/${ev.id}`} alt={`Foto ${ev.id}`} />
                  : <span className="video-miniatura">Vídeo</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
      {webcam && <Webcam onFechar={() => setWebcam(false)} onCapturar={enviar} enviando={enviando} feito={feito} total={evidencias.length} />}
    </section>
  );
}

function Webcam({ onFechar, onCapturar, enviando, feito, total }:
  { onFechar: () => void; onCapturar: (f: File) => Promise<void>; enviando: boolean; feito: string | null; total: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const fluxo = useRef<MediaStream | null>(null);
  const gravador = useRef<MediaRecorder | null>(null);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((s) => {
        if (!ativo) return s.getTracks().forEach((t) => t.stop());
        fluxo.current = s;
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setErro("Não consegui abrir a webcam. Libere a câmera no navegador e tente de novo."));
    return () => {
      ativo = false;
      gravador.current?.state === "recording" && gravador.current.stop();
      fluxo.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  function foto() {
    const v = video.current;
    if (!v) return;
    const tela = document.createElement("canvas");
    tela.width = v.videoWidth;
    tela.height = v.videoHeight;
    tela.getContext("2d")!.drawImage(v, 0, 0);
    tela.toBlob((b) => b && void onCapturar(new File([b], "webcam.jpg", { type: "image/jpeg" })), "image/jpeg", 0.9);
  }

  function alternarGravacao() {
    if (gravando) {
      gravador.current?.stop();
      return;
    }
    if (!fluxo.current) return;
    const partes: Blob[] = [];
    const g = new MediaRecorder(fluxo.current, { mimeType: "video/webm" });
    g.ondataavailable = (e) => partes.push(e.data);
    // O backend aceita "video/webm" exato; o tipo do gravador vem com codecs e seria recusado.
    g.onstop = () => {
      setGravando(false);
      void onCapturar(new File(partes, "webcam.webm", { type: "video/webm" }));
    };
    g.start();
    gravador.current = g;
    setGravando(true);
  }

  return (
    <div className="webcam" role="dialog" aria-modal="true" aria-label="Webcam">
      <div className="webcam-caixa">
        {erro ? <p className="aviso erro" role="alert">{erro}</p> : <video ref={video} autoPlay playsInline muted />}
        <p className={enviando ? "sub" : feito ? "aviso ok" : "sub"} role="status">
          {enviando ? "Enviando…" : feito ? `✓ ${feito}. ${total} no total.` : "Enquadre o produto e tire a foto."}
        </p>
        <div className="acoes-evidencia">
          <button type="button" className="botao principal" onClick={foto} disabled={!!erro || gravando || enviando}>{enviando ? "Enviando…" : "Tirar foto"}</button>
          <button type="button" className={gravando ? "botao alerta" : "botao"} onClick={alternarGravacao} disabled={!!erro}>
            {gravando ? "Parar e enviar vídeo" : "Gravar vídeo"}
          </button>
          <button type="button" className="botao" onClick={onFechar}>Fechar</button>
        </div>
      </div>
    </div>
  );
}
