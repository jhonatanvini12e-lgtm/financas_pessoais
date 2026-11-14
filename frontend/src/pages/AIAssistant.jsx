import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';

const SUGGESTIONS = [
    'Como esta minha saude financeira?',
    'Como sair das dividas mais rapido?',
    'Gerar relatorio do mes',
    'Onde posso cortar gastos?',
];

function formatTime(iso) {
    if (!iso) return '';
    return new Date(`${iso.replace(' ', 'T')}Z`).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function AIAssistant() {
    const [messages, setMessages] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(true);
    const [input, setInput] = useState('');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState('');
    const scrollRef = useRef(null);

    const load = () => {
        api.get('/ai-assistant').then((data) => {
            setMessages(data);
            setLoadingHistory(false);
        }).catch((err) => {
            setError(err.message);
            setLoadingHistory(false);
        });
    };

    useEffect(load, []);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages.length, sending]);

    const send = async (text) => {
        const message = text.trim();
        if (!message || sending) return;
        setError('');
        setInput('');
        setSending(true);
        try {
            const { userMessage, assistantMessage } = await api.post('/ai-assistant', { message });
            setMessages((prev) => [...prev, userMessage, assistantMessage]);
        } catch (err) {
            setError(err.message);
        } finally {
            setSending(false);
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        send(input);
    };

    const newConversation = async () => {
        if (!window.confirm('Apagar todo o historico desta conversa?')) return;
        try {
            await api.delete('/ai-assistant');
            setMessages([]);
        } catch (err) {
            setError(err.message);
        }
    };

    return (
        <div className="page">
            <div className="page-header-row">
                <h1>Assistente de IA</h1>
                {messages.length > 0 && (
                    <button type="button" className="btn-link" onClick={newConversation}>Nova conversa</button>
                )}
            </div>

            <section className="card ai-chat-card">
                <div className="ai-chat-messages" ref={scrollRef}>
                    {!loadingHistory && messages.length === 0 && (
                        <div className="ai-chat-empty">
                            <p className="muted">
                                Pergunte sobre suas contas, cartoes, orcamento, dividas ou investimentos. As respostas
                                usam os dados reais cadastrados no app.
                            </p>
                            <div className="ai-chat-suggestions">
                                {SUGGESTIONS.map((s) => (
                                    <button key={s} type="button" className="ai-chat-suggestion" onClick={() => send(s)}>
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {messages.map((m) => (
                        <div key={m.id} className={`ai-chat-bubble ${m.role === 'user' ? 'ai-chat-bubble-user' : 'ai-chat-bubble-assistant'}`}>
                            <p>{m.content}</p>
                            <span className="ai-chat-time">{formatTime(m.created_at)}</span>
                        </div>
                    ))}

                    {sending && (
                        <div className="ai-chat-bubble ai-chat-bubble-assistant ai-chat-bubble-pending">Pensando...</div>
                    )}
                </div>

                {error && <div className="error-msg">{error}</div>}

                <form className="ai-chat-input-row" onSubmit={handleSubmit}>
                    <textarea
                        className="ai-chat-input"
                        placeholder="Pergunte algo sobre suas financas..."
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                send(input);
                            }
                        }}
                        rows={1}
                    />
                    <button type="submit" className="btn-primary ai-chat-send" disabled={sending || !input.trim()}>
                        {sending ? 'Enviando...' : 'Enviar'}
                    </button>
                </form>
            </section>
        </div>
    );
}
