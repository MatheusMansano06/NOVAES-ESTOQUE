import { useEffect, useRef, useState, type RefObject } from "react";

import { api } from "../../shared/api";
import { DetectorParado } from "./detectorParado";

const INTERVALO_MS = 250;
const QUADRO = { largura: 64, altura: 36 };
const MAX_FOTOS_AUTO = 8; // tudo que fica vai para a plataforma na contestação; não pode virar enxurrada
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

function capturar(v: HTMLVideoElement): Promise<File | null> {
  const tela = document.createElement("canvas");
  tela.width = v.videoWidth;
  tela.height = v.videoHeight;
  tela.getContext("2d")!.drawImage(v, 0, 0);
  return new Promise((ok) => tela.toBlob((b) => ok(b && new File([b], "bancada.jpg", { type: "image/jpeg" })), "image/jpeg", 0.85));
}

type Estado = "desligada" | "abrindo" | "gravando" | "limite" | "sem_camera";
type Envio = "ocioso" | "enviando" | "ok" | "erro";

export interface Gravacao {
  video: RefObject<HTMLVideoElement>;
  estado: Estado;
  fotos: number;
  ultimaFoto: string | null;
  progresso: number;
  envio: Envio;
  erroEnvio: string | null;
  cameras: MediaDeviceInfo[];
  camera: string;
  trocarCamera: (id: string) => void;
  tirarFoto: () => void;
  /** Termina a gravação. Com destino, sobe vídeo e fotos para a devolução; sem destino, joga tudo fora. */
  encerrar: (destino: number | null, onEnviada: () => void) => Promise<void>;
  tentarDeNovo: (onEnviada: () => void) => void;
  /** Fechar agora perderia material que ainda não está no servidor. */
  perderia: () => boolean;
}

/** Filma enquanto `ativa`. Tudo fica na memória do navegador até a conferência decidir se vale guardar. */
export function useGravacao(ativa: boolean): Gravacao {
  const video = useRef<HTMLVideoElement>(null);
  const gravador = useRef<MediaRecorder | null>(null);
  const partes = useRef<Blob[]>([]);
  const fotosGuardadas = useRef<File[]>([]);
  const fila = useRef<{ destino: number; arquivos: File[] } | null>(null);
  const [estado, setEstado] = useState<Estado>("desligada");
  const [fotos, setFotos] = useState(0);
  const [ultimaFoto, setUltimaFoto] = useState<string | null>(null);
  const [progresso, setProgresso] = useState(0);
  const [envio, setEnvio] = useState<Envio>("ocioso");
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [camera, setCamera] = useState(cameraSalva);

  function guardarFoto(f: File | null) {
    if (!f) return;
    fotosGuardadas.current.push(f);
    setFotos(fotosGuardadas.current.length);
    setUltimaFoto((antiga) => {
      if (antiga) URL.revokeObjectURL(antiga);
      return URL.createObjectURL(f);
    });
  }

  useEffect(() => {
    if (!ativa) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setEstado("sem_camera");
      return;
    }
    let viva = true;
    let fluxo: MediaStream | null = null;
    let detector = 0;
    let limite = 0;
    setEstado("abrindo");
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720, ...(camera ? { deviceId: { ideal: camera } } : {}) }, audio: false })
      .then(async (s) => {
        if (!viva) return s.getTracks().forEach((t) => t.stop());
        fluxo = s;
        if (video.current) video.current.srcObject = s;
        // Os nomes das câmeras só aparecem depois da permissão concedida.
        navigator.mediaDevices.enumerateDevices()
          .then((d) => viva && setCameras(d.filter((x) => x.kind === "videoinput")))
          .catch(() => {});

        const formato = formatoVideo();
        if (!formato) return setEstado("sem_camera");
        partes.current = [];
        const g = new MediaRecorder(s, { mimeType: formato, videoBitsPerSecond: BITS_POR_SEGUNDO });
        g.ondataavailable = (e) => { if (e.data.size) partes.current.push(e.data); };
        g.start(1000);
        gravador.current = g;
        setEstado("gravando");
        limite = window.setTimeout(() => { g.stop(); setEstado("limite"); }, MAX_GRAVACAO_MS);

        const tela = document.createElement("canvas");
        tela.width = QUADRO.largura;
        tela.height = QUADRO.altura;
        const ctx = tela.getContext("2d", { willReadFrequently: true })!;
        const parado = new DetectorParado();
        let autos = 0;
        detector = window.setInterval(() => {
          const v = video.current;
          if (!v || !v.videoWidth || autos >= MAX_FOTOS_AUTO) return setProgresso(0);
          ctx.drawImage(v, 0, 0, QUADRO.largura, QUADRO.altura);
          const { data } = ctx.getImageData(0, 0, QUADRO.largura, QUADRO.altura);
          const cinza = new Uint8Array(QUADRO.largura * QUADRO.altura);
          for (let i = 0; i < cinza.length; i++) cinza[i] = (data[i * 4] * 2 + data[i * 4 + 1] * 5 + data[i * 4 + 2]) >> 3;
          const r = parado.avaliar(cinza, performance.now());
          setProgresso(r.progresso);
          if (r.fotografar) {
            autos++;
            void capturar(v).then(guardarFoto);
          }
        }, INTERVALO_MS);
      })
      .catch(() => viva && setEstado("sem_camera"));
    return () => {
      viva = false;
      clearInterval(detector);
      clearTimeout(limite);
      if (gravador.current?.state === "recording") gravador.current.stop();
      gravador.current = null;
      fluxo?.getTracks().forEach((t) => t.stop());
      setEstado("desligada");
      setProgresso(0);
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
    const g = gravador.current;
    if (g?.state === "recording") {
      await new Promise((ok) => { g.addEventListener("stop", ok, { once: true }); g.stop(); });
    }
    const formato = g?.mimeType.split(";")[0];
    const arquivos = [...fotosGuardadas.current];
    if (formato && partes.current.length) {
      arquivos.push(new File(partes.current, formato === "video/mp4" ? "bancada.mp4" : "bancada.webm", { type: formato }));
    }
    partes.current = [];
    fotosGuardadas.current = [];
    setFotos(0);
    setUltimaFoto((antiga) => {
      if (antiga) URL.revokeObjectURL(antiga);
      return null;
    });
    if (destino === null || !arquivos.length) return;
    fila.current = { destino, arquivos };
    await subir(onEnviada);
  }

  return {
    video, estado, fotos, ultimaFoto, progresso, envio, erroEnvio, cameras, camera, encerrar,
    trocarCamera(id) {
      try { localStorage.setItem(CHAVE_CAMERA, id); } catch { /* sem armazenamento: só não lembra */ }
      setCamera(id);
    },
    tirarFoto() {
      if (video.current?.videoWidth) void capturar(video.current).then(guardarFoto);
    },
    tentarDeNovo: (onEnviada) => void subir(onEnviada),
    perderia: () => estado === "gravando" || estado === "limite" || !!fila.current,
  };
}

const ENVIANDO = "Enviando o vídeo e as fotos…";

export function PainelGravacao({ g, ativa, onEnviada }: { g: Gravacao; ativa: boolean; onEnviada: () => void }) {
  return (
    <>
      {ativa && g.estado !== "sem_camera" && (
        <section className="gravacao" aria-label="Gravação da bancada">
          <video ref={g.video} autoPlay playsInline muted />
          <div className="gravacao-info">
            <p role="status">
              {g.estado === "abrindo" && "Abrindo a câmera…"}
              {g.estado === "gravando" && <><span className="gravacao-rec" aria-hidden="true" /><strong>Gravando</strong></>}
              {g.estado === "limite" && <strong>A gravação parou no limite de 20 minutos. O que foi filmado está guardado.</strong>}
            </p>
            <p className="sub">Segure o produto parado por 3 segundos e a foto sai sozinha.</p>
            <div className="gravacao-progresso" role="progressbar" aria-label="Foto automática" aria-valuemin={0} aria-valuemax={100}
                 aria-valuenow={Math.round(g.progresso * 100)}>
              <span style={{ width: `${g.progresso * 100}%` }} />
            </div>
            <div className="acoes-evidencia">
              <button type="button" className="botao" onClick={g.tirarFoto} disabled={g.estado !== "gravando"}>Tirar foto agora</button>
              {g.cameras.length > 1 && (
                <select aria-label="Câmera" value={g.camera} onChange={(e) => g.trocarCamera(e.target.value)}>
                  <option value="">Câmera padrão</option>
                  {g.cameras.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Câmera ${i + 1}`}</option>)}
                </select>
              )}
            </div>
            <p className="sub">{g.fotos === 1 ? "1 foto" : `${g.fotos} fotos`}. Só fica guardado se a conferência indicar mediação.</p>
          </div>
          {g.ultimaFoto && <img src={g.ultimaFoto} alt="Última foto tirada" />}
        </section>
      )}
      {ativa && g.estado === "sem_camera" && (
        <p className="aviso" role="status">Sem câmera: esta conferência não está sendo gravada. Libere a câmera no navegador ou anexe as provas no próximo passo.</p>
      )}
      {g.envio === "enviando" && <p className="aviso" role="status">{ENVIANDO}</p>}
      {g.envio === "erro" && (
        <p className="aviso erro" role="alert">
          Não consegui enviar o vídeo e as fotos: {g.erroEnvio}{" "}
          <button type="button" className="botao" onClick={() => g.tentarDeNovo(onEnviada)}>Tentar de novo</button>
        </p>
      )}
    </>
  );
}
