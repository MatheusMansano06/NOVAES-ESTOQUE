import { useEffect, useRef, useState, type RefObject } from "react";

import { api } from "../../shared/api";

const BITS_POR_SEGUNDO = 1_200_000; // ~9 MB por minuto
const MAX_GRAVACAO_MS = 20 * 60_000; // ~180 MB, abaixo do limite de 200 MB do backend
const CHAVE_CAMERA = "cameraBancada";

function cameraSalva() {
  try { return localStorage.getItem(CHAVE_CAMERA) ?? ""; } catch { return ""; }
}

/** mp4 quando o navegador grava (é o que os painéis de suporte aceitam); o tipo vai sem codecs porque o backend compara exato. */
function formatoVideo() {
  return ["video/mp4", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
}

type Estado = "desligada" | "abrindo" | "gravando" | "limite" | "sem_camera";
type Envio = "ocioso" | "enviando" | "ok" | "erro";

export interface Gravacao {
  video: RefObject<HTMLVideoElement>;
  estado: Estado;
  inicio: number | null;
  envio: Envio;
  erroEnvio: string | null;
  cameras: MediaDeviceInfo[];
  camera: string;
  trocarCamera: (id: string) => void;
  /** Termina a gravação. Com destino, sobe o vídeo para a devolução; sem destino, joga fora. */
  encerrar: (destino: number | null, onEnviada: () => void) => Promise<void>;
  tentarDeNovo: (onEnviada: () => void) => void;
  /** Fechar agora perderia material que ainda não está no servidor. */
  perderia: () => boolean;
}

/** Filma enquanto `ativa`. Desligar só para a câmera: o vídeo fica na memória do navegador até a conferência decidir. */
export function useGravacao(ativa: boolean): Gravacao {
  const video = useRef<HTMLVideoElement>(null);
  const gravador = useRef<MediaRecorder | null>(null);
  const partes = useRef<Blob[]>([]);
  const formato = useRef<string | null>(null);
  const parou = useRef<Promise<void>>(Promise.resolve());
  const fila = useRef<{ destino: number; arquivos: File[] } | null>(null);
  const [estado, setEstado] = useState<Estado>("desligada");
  const [inicio, setInicio] = useState<number | null>(null);
  const [envio, setEnvio] = useState<Envio>("ocioso");
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [camera, setCamera] = useState(cameraSalva);

  useEffect(() => {
    if (!ativa) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setEstado("sem_camera");
      return;
    }
    let viva = true;
    let fluxo: MediaStream | null = null;
    let limite = 0;
    setEstado("abrindo");
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720, ...(camera ? { deviceId: { ideal: camera } } : {}) }, audio: false })
      .then((s) => {
        if (!viva) return s.getTracks().forEach((t) => t.stop());
        fluxo = s;
        if (video.current) video.current.srcObject = s;
        // Os nomes das câmeras só aparecem depois da permissão concedida.
        navigator.mediaDevices.enumerateDevices()
          .then((d) => viva && setCameras(d.filter((x) => x.kind === "videoinput")))
          .catch(() => {});

        const tipo = formatoVideo();
        if (!tipo) return setEstado("sem_camera");
        // Trocar de câmera recomeça o vídeo: um arquivo só, de uma câmera só.
        partes.current = [];
        formato.current = tipo;
        const g = new MediaRecorder(s, { mimeType: tipo, videoBitsPerSecond: BITS_POR_SEGUNDO });
        g.ondataavailable = (e) => { if (e.data.size) partes.current.push(e.data); };
        // O último pedaço chega depois do stop: quem for montar o arquivo espera por ele.
        parou.current = new Promise((ok) => g.addEventListener("stop", () => ok(), { once: true }));
        g.start(1000);
        gravador.current = g;
        setEstado("gravando");
        setInicio(Date.now());
        limite = window.setTimeout(() => { g.stop(); setEstado("limite"); }, MAX_GRAVACAO_MS);
      })
      .catch(() => viva && setEstado("sem_camera"));
    return () => {
      viva = false;
      clearTimeout(limite);
      if (gravador.current?.state === "recording") gravador.current.stop();
      gravador.current = null;
      fluxo?.getTracks().forEach((t) => t.stop());
      setEstado((e) => (e === "sem_camera" ? e : "desligada"));
      setInicio(null);
    };
  }, [ativa, camera]);

  async function subir(onEnviada: () => void) {
    const pacote = fila.current;
    if (!pacote) return;
    setErroEnvio(null);
    setEnvio("enviando");
    try {
      // Tira da fila só o que subiu: tentar de novo continua de onde parou, sem duplicar.
      while (pacote.arquivos.length) {
        await api.enviarArquivo(`/conferencia/${pacote.destino}/evidencias`, pacote.arquivos[0]);
        pacote.arquivos.shift();
      }
      fila.current = null;
      setEnvio("ok");
      onEnviada();
    } catch (e) {
      setErroEnvio((e as Error).message);
      setEnvio("erro");
    }
  }

  async function encerrar(destino: number | null, onEnviada: () => void) {
    if (gravador.current?.state === "recording") gravador.current.stop();
    await parou.current;
    const tipo = formato.current;
    const arquivos: File[] = [];
    if (tipo && partes.current.length) {
      arquivos.push(new File(partes.current, tipo === "video/mp4" ? "bancada.mp4" : "bancada.webm", { type: tipo }));
    }
    partes.current = [];
    if (destino === null || !arquivos.length) return;
    fila.current = { destino, arquivos };
    await subir(onEnviada);
  }

  return {
    video, estado, inicio, envio, erroEnvio, cameras, camera, encerrar,
    trocarCamera(id) {
      try { localStorage.setItem(CHAVE_CAMERA, id); } catch { /* sem armazenamento: só não lembra */ }
      setCamera(id);
    },
    tentarDeNovo: (onEnviada) => void subir(onEnviada),
    perderia: () => estado === "gravando" || partes.current.length > 0 || !!fila.current,
  };
}

function relogio(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Primeiro passo da conferência: a câmera em tela cheia filmando a abertura do pacote. */
export function EtapaFilmagem({ g, onTerminar }: { g: Gravacao; onTerminar: () => void }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => {
    if (!g.inicio) return;
    const t = window.setInterval(() => setAgora(Date.now()), 500);
    return () => clearInterval(t);
  }, [g.inicio]);

  return (
    <section className="filmagem" aria-label="Gravação da abertura do pacote">
      <div className="filmagem-tela">
        {g.estado === "sem_camera" ? (
          <p className="filmagem-sem">
            Sem câmera: esta conferência não vai ser gravada.<br />
            Libere a câmera no navegador (cadeado ao lado do endereço) ou siga sem vídeo.
          </p>
        ) : (
          <video ref={g.video} autoPlay playsInline muted />
        )}
        {g.estado === "abrindo" && <span className="filmagem-selo">Abrindo a câmera…</span>}
        {g.estado === "gravando" && g.inicio && (
          <span className="filmagem-selo rec" role="status">
            <span className="gravacao-rec" aria-hidden="true" />REC {relogio(Math.max(0, agora - g.inicio))}
          </span>
        )}
        {g.estado === "limite" && <span className="filmagem-selo" role="status">Parou no limite de 20 minutos. O que foi filmado está guardado.</span>}
      </div>
      <div className="filmagem-barra">
        <p className="sub">Abra o pacote na frente da câmera e mostre o produto por todos os lados.</p>
        {g.cameras.length > 1 && (
          <select aria-label="Câmera" value={g.camera} onChange={(e) => g.trocarCamera(e.target.value)}>
            <option value="">Câmera padrão</option>
            {g.cameras.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Câmera ${i + 1}`}</option>)}
          </select>
        )}
        <button type="button" className="botao principal" onClick={onTerminar} disabled={g.estado === "abrindo"} autoFocus>
          {g.estado === "sem_camera" ? "Seguir sem vídeo" : "Terminar vídeo e conferir"}
        </button>
      </div>
    </section>
  );
}

/** Aviso do envio do vídeo, que roda em segundo plano depois do checklist. */
export function EnvioGravacao({ g, onEnviada }: { g: Gravacao; onEnviada: () => void }) {
  if (g.envio === "enviando") return <p className="aviso" role="status">Enviando o vídeo…</p>;
  if (g.envio !== "erro") return null;
  return (
    <p className="aviso erro" role="alert">
      Não consegui enviar o vídeo: {g.erroEnvio}{" "}
      <button type="button" className="botao" onClick={() => g.tentarDeNovo(onEnviada)}>Tentar de novo</button>
    </p>
  );
}
