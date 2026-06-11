import { useState } from 'react';
import { uploadNFe, aceitarSugestaoVinculo } from '../services/api';
import './UploadNFe.css';
export default function UploadNFe({ onUploadSuccess }) {
    const [file, setFile] = useState(null);
    const [loading, setLoading] = useState(false);
    const [acceptingIndex, setAcceptingIndex] = useState(null);
    const [message, setMessage] = useState(null);
    const [result, setResult] = useState(null);
    const handleFileChange = (e) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            const ext = selectedFile.name.split('.').pop()?.toLowerCase();
            if (['xml', 'pdf'].includes(ext || '')) {
                setFile(selectedFile);
                setMessage(null);
            }
            else {
                setMessage({ type: 'error', text: 'Por favor, selecione um arquivo XML ou PDF' });
                setFile(null);
            }
        }
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!file) {
            setMessage({ type: 'error', text: 'Selecione um arquivo primeiro' });
            return;
        }
        setLoading(true);
        setMessage(null);
        try {
            const response = await uploadNFe(file);
            setResult(response);
            setMessage({
                type: 'success',
                text: `NF #${response.numero_nf} processada com sucesso! ${response.itens_encontrados} itens encontrados`
            });
            setFile(null);
            onUploadSuccess();
        }
        catch (error) {
            setMessage({
                type: 'error',
                text: error.response?.data?.detail || 'Erro ao processar arquivo'
            });
        }
        finally {
            setLoading(false);
        }
    };
    const handleAceitarSugestao = async (index) => {
        if (!result?.sugestoes_vinculacao?.[index])
            return;
        setAcceptingIndex(index);
        try {
            const sugestao = result.sugestoes_vinculacao[index];
            await aceitarSugestaoVinculo(sugestao.item_id, sugestao.sugestao);
            // Remove a sugestão da lista
            const novasSugestoes = result.sugestoes_vinculacao.filter((_, i) => i !== index);
            setResult({ ...result, sugestoes_vinculacao: novasSugestoes });
            setMessage({
                type: 'success',
                text: `✓ Vinculado: ${sugestao.sugestao.olist_nome}`
            });
        }
        catch (error) {
            setMessage({
                type: 'error',
                text: 'Erro ao aceitar sugestão'
            });
        }
        finally {
            setAcceptingIndex(null);
        }
    };
    return (<div className="upload-container">
      <form onSubmit={handleSubmit}>
        <div className="upload-area">
          <input type="file" accept=".xml,.pdf" onChange={handleFileChange} disabled={loading} id="file-input"/>
          <label htmlFor="file-input" className="upload-label">
            <div className="upload-icon">📄</div>
            <p>
              {file ? `Arquivo: ${file.name}` : 'Clique para selecionar ou arraste um arquivo XML/PDF'}
            </p>
            <small>Máximo 10MB</small>
          </label>
        </div>

        {message && (<div className={`message message-${message.type}`}>
            {message.type === 'success' ? '✓' : '✕'} {message.text}
          </div>)}

        {result && (<div className="result-summary">
            <h3>✓ Processado com Sucesso</h3>
            <dl>
              <dt>ID:</dt>
              <dd>{result.id}</dd>
              <dt>NF:</dt>
              <dd>{result.numero_nf}</dd>
              <dt>Itens:</dt>
              <dd>{result.itens_encontrados}</dd>
              <dt>Status:</dt>
              <dd>{result.status}</dd>
            </dl>

            {result.sugestoes_vinculacao && result.sugestoes_vinculacao.length > 0 && (<div className="sugestoes-vinculacao">
                <h4>💡 {result.sugestoes_vinculacao.length} Vinculação(ões) Sugerida(s)</h4>
                <div className="sugestoes-list">
                  {result.sugestoes_vinculacao.map((sugestao, idx) => (<div key={idx} className="sugestao-item">
                      <div className="sugestao-info">
                        <div className="produto-nf">
                          <strong>{sugestao.descricao}</strong>
                        </div>
                        <div className="confiance-bar">
                          <div className="confiance-fill" style={{ width: `${sugestao.confianca}%` }}></div>
                        </div>
                        <div className="confiance-text">{sugestao.confianca}% de confiança</div>
                        <div className="produto-olist">
                          <small>→ {sugestao.sugestao.olist_nome}</small>
                        </div>
                      </div>
                      <button type="button" className="btn-aceitar" onClick={() => handleAceitarSugestao(idx)} disabled={acceptingIndex === idx}>
                        {acceptingIndex === idx ? '...' : '✓'}
                      </button>
                    </div>))}
                </div>
              </div>)}
          </div>)}

        <button type="submit" disabled={!file || loading} className="submit-btn">
          {loading ? 'Processando...' : 'Enviar NF-e'}
        </button>
      </form>
    </div>);
}
