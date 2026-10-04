import { useCallback, useState } from 'react';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from '../api/client.js';
import { useAuth } from '../context/AuthContext.jsx';
import Logo from '../components/Logo.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

// O leitor biometrico (fingerprint/PIN via WebAuthn) pode ainda nao ter
// reinicializado logo apos o notebook sair de suspensao (tampa fechada) --
// nesse caso `startAuthentication` fica pendurado sem resolver nem
// rejeitar. Sem esse timeout, a tela travava para sempre em "Aguardando
// biometria..." sem cair pro fallback por e-mail.
const BIOMETRIC_TIMEOUT_MS = 15000;

// ---------- cena de fundo: uma vida inteira sobe num grafico ondulado ate o
// topo. Toda a coreografia (estacoes, figura envelhecendo, estouro de luz,
// card) e' CSS puro (ver "Login: jornada interativa" em index.css) --- aqui
// so' montamos o DOM e alternamos a classe `login-scene--on`. Quem tem
// prefers-reduced-motion ativado ja cai direto no estado final (a regra
// global em index.css zera a duration de toda animation/transition).

const STAR_LAYOUT = [
    [4, 8, 2.2], [88, 14, 1.6], [21, 6, 2.6], [95, 22, 1.8], [8, 15, 1.4], [90, 36, 2.0],
    [6, 34, 1.8], [93, 6, 2.4], [80, 20, 1.6], [4, 24, 2.2], [96, 30, 1.4], [12, 10, 1.6],
];
const STARS = STAR_LAYOUT.map(([left, top, size], i) => ({ left, top, size, delay: (i % 7) * 0.5 }));

// Mesmos pontos da curva do grafico (path abaixo), com o delay em ms
// proporcional a quanto ja foi percorrido da linha (4.8s no total) -- cada
// ponto acende quando a linha "passa" por ele.
const CHART_PATH = 'M8,95 L12,92 L16,94 L20,87 L24,90 L28,82 L32,85 L36,76 L40,79 L44,68 L48,71 L52,60 L56,63 L60,50 L64,53 L68,40 L72,42 L76,28 L80,22 L84,16 L88,10 L92,6';
const DOTS = [
    { x: 8, y: 95, delay: 0 },
    { x: 24, y: 90, delay: 662 },
    { x: 40, y: 79, delay: 1508 },
    { x: 52, y: 60, delay: 2342 },
    { x: 64, y: 53, delay: 3038 },
    { x: 76, y: 28, delay: 3998 },
    { x: 92, y: 6, delay: 4800 },
];
const BLOSSOMS = [
    { left: 10, delay: 0.05 }, { left: 24, delay: 0.2 }, { left: 40, delay: 0.1 },
    { left: 58, delay: 0.25 }, { left: 74, delay: 0.15 }, { left: 90, delay: 0.0 },
];
const LEAF_COLORS = ['#d97706', '#b45309', '#f59e0b', '#9a3412'];
const LEAVES = [
    { left: 6, dur: 4.4, delay: 0.0 }, { left: 18, dur: 5.1, delay: 0.5 },
    { left: 30, dur: 4.7, delay: 0.2 }, { left: 42, dur: 5.4, delay: 0.8 },
    { left: 54, dur: 4.9, delay: 0.3 }, { left: 64, dur: 5.2, delay: 0.6 },
    { left: 74, dur: 4.6, delay: 0.1 }, { left: 84, dur: 5.0, delay: 0.7 },
    { left: 92, dur: 4.8, delay: 0.4 }, { left: 50, dur: 5.3, delay: 0.9 },
].map((l, i) => ({ ...l, color: LEAF_COLORS[i % LEAF_COLORS.length] }));
const SNOW = [
    { left: 3, size: 5, dur: 7.5, delay: 0.1 }, { left: 12, size: 4, dur: 8.4, delay: 0.6 },
    { left: 21, size: 6, dur: 6.8, delay: 0.3 }, { left: 30, size: 4, dur: 7.9, delay: 0.9 },
    { left: 38, size: 5, dur: 8.8, delay: 0.0 }, { left: 47, size: 4, dur: 7.1, delay: 0.5 },
    { left: 55, size: 6, dur: 8.2, delay: 0.2 }, { left: 63, size: 5, dur: 7.6, delay: 0.8 },
    { left: 71, size: 4, dur: 8.6, delay: 0.4 }, { left: 79, size: 6, dur: 7.3, delay: 0.1 },
    { left: 87, size: 5, dur: 8.0, delay: 0.7 }, { left: 95, size: 4, dur: 7.8, delay: 0.3 },
    { left: 16, size: 5, dur: 8.3, delay: 1.1 }, { left: 67, size: 5, dur: 7.4, delay: 1.0 },
    { left: 44, size: 4, dur: 8.1, delay: 1.3 }, { left: 83, size: 6, dur: 7.0, delay: 1.2 },
];

function SeasonIcon({ season }) {
    const stroke = season === 'winter' ? '#fff7e6' : '#f1f5f9';
    const strokeWidth = season === 'winter' ? 1.6 : 1.8;
    return (
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round">
            {season === 'spring' && <><path d="M12 22c0-5 0-9 0-13" /><path d="M12 9c-3 0-5-2-5-5 3 0 5 2 5 5Z" /><path d="M12 9c3 0 5-2 5-5-3 0-5 2-5 5Z" /></>}
            {season === 'summer' && <><circle cx="12" cy="12" r="4.3" /><path d="M12 3v2.4M12 18.6V21M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M3 12h2.4M18.6 12H21M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" /></>}
            {season === 'autumn' && <path d="M12 3c4 2 6 6 4 11-1.6 3.8-6 5-9 3 4-1 5-4 4-7-3 1-5-1-5-4 2 1 4 0 6-3Z" />}
            {season === 'winter' && <path d="M12 2v20M4 7l16 10M20 7 4 17M2 12h20" />}
        </svg>
    );
}

// Os 5 estagios de vida do bonequinho que sobe pelo grafico -- todos
// empilhados no mesmo lugar, o CSS cruza a opacidade de um pro outro
// conforme a estacao muda (ver .login-fig-* em index.css).
function AgingFigures() {
    return (
        <>
            <svg className="login-fig-young" viewBox="0 0 30 40">
                <circle cx="15" cy="8" r="5" fill="#f3d2ab" />
                <path d="M10 7a5 5 0 0 1 10 0" fill="none" stroke="#2b2118" strokeWidth="3" strokeLinecap="round" />
                <path d="M15 13v13" stroke="#f8fafc" strokeWidth="7" strokeLinecap="round" />
                <path d="M15 16l-6 5M15 16l6 5" stroke="#f8fafc" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M15 26l-5 9M15 26l5 9" stroke="#f8fafc" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
            <svg className="login-fig-adult" viewBox="0 0 30 40">
                <circle cx="15" cy="8" r="5" fill="#f3d2ab" />
                <path d="M10 7a5 5 0 0 1 10 0" fill="none" stroke="#2b2118" strokeWidth="3" strokeLinecap="round" />
                <path d="M15 13v14" stroke="#f8fafc" strokeWidth="7" strokeLinecap="round" />
                <path d="M15 17l-6 3M15 17l6 2" stroke="#f8fafc" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M15 27l-4 9M15 27l4 9" stroke="#f8fafc" strokeWidth="2.6" strokeLinecap="round" />
                <rect x="19" y="21" width="6" height="5" rx="1" fill="#1d2433" stroke="#64748b" strokeWidth="0.6" />
            </svg>
            <svg className="login-fig-middle" viewBox="0 0 30 40">
                <circle cx="16" cy="9" r="5" fill="#f3d2ab" />
                <path d="M11 8a5 5 0 0 1 10 0" fill="none" stroke="#94a3b8" strokeWidth="3" strokeLinecap="round" />
                <path d="M16 14q3 6 1 15" fill="none" stroke="#f1f5f9" strokeWidth="7" strokeLinecap="round" />
                <path d="M15 18l-6 3M16 18l5 4" stroke="#f1f5f9" strokeWidth="2.4" strokeLinecap="round" />
                <path d="M14 29l-4 9M15 29l4 9" stroke="#f1f5f9" strokeWidth="2.6" strokeLinecap="round" />
            </svg>
            <svg className="login-fig-elderly" viewBox="0 0 30 40">
                <circle cx="17" cy="10" r="4.6" fill="#f3d2ab" />
                <path d="M12.5 9a4.6 4.6 0 0 1 9 0" fill="none" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" />
                <path d="M17 14q5 7 0 16" fill="none" stroke="#e5e7eb" strokeWidth="6.5" strokeLinecap="round" />
                <path d="M16 19l-5 3" stroke="#e5e7eb" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M19 19l3 2" stroke="#e5e7eb" strokeWidth="2.2" strokeLinecap="round" />
                <path d="M22 21l2 15" stroke="#cbd5e1" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M13 30l-3 8M15 30l2 9" stroke="#e5e7eb" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            <svg className="login-fig-triumphant" viewBox="0 0 30 40">
                <circle cx="15" cy="8" r="5" fill="#fde8c8" />
                <path d="M10 7a5 5 0 0 1 10 0" fill="none" stroke="#f8fafc" strokeWidth="3" strokeLinecap="round" />
                <path d="M15 13v14" stroke="#fff7e6" strokeWidth="7" strokeLinecap="round" />
                <path d="M15 16l-6 -7M15 16l6 -7" stroke="#fff7e6" strokeWidth="2.6" strokeLinecap="round" />
                <path d="M15 27l-4 9M15 27l4 9" stroke="#fff7e6" strokeWidth="2.6" strokeLinecap="round" />
                <path d="M21 9l3 -3" stroke="#e0ab4a" strokeWidth="1.6" strokeLinecap="round" />
                <path d="M24 6l-4 2 4 2Z" fill="#e0ab4a" />
            </svg>
        </>
    );
}

export default function Login() {
    const { login } = useAuth();
    const [step, setStep] = useState(1); // 1: credenciais, 2: codigo por e-mail, 3: biometria
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [code, setCode] = useState('');
    const [userId, setUserId] = useState(null);
    const [newDevice, setNewDevice] = useState(false);
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [biometricPending, setBiometricPending] = useState(false);
    const [journeyOn, setJourneyOn] = useState(false);
    const toggleJourney = () => setJourneyOn((on) => !on);

    const tryBiometricLogin = useCallback(
        async (id) => {
            setBiometricPending(true);
            setError('');
            let timedOut = false;
            const timeoutId = setTimeout(() => {
                timedOut = true;
                setBiometricPending(false);
                setError('A verificacao por biometria demorou demais. Tente novamente ou use o codigo por e-mail.');
            }, BIOMETRIC_TIMEOUT_MS);
            try {
                const optionsJSON = await api.post('/auth/webauthn/login-options', { userId: id });
                const assertion = await startAuthentication({ optionsJSON });
                await api.post('/auth/webauthn/login-verify', { userId: id, ...assertion });
                if (timedOut) return;
                await login();
            } catch {
                if (timedOut) return;
                setError('Nao foi possivel confirmar a biometria. Tente novamente ou use o codigo por e-mail.');
            } finally {
                clearTimeout(timeoutId);
                if (!timedOut) setBiometricPending(false);
            }
        },
        [login]
    );

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        setLoading(true);
        try {
            const data = await api.post('/auth/login', { username, password });
            setUserId(data.userId);
            setNewDevice(data.newDevice);
            if (data.method === 'webauthn') {
                setStep(3);
                tryBiometricLogin(data.userId);
            } else {
                setStep(2);
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (e) => {
        e.preventDefault();
        setError('');
        try {
            await api.post('/auth/verify-2fa', { userId, code });
            await login();
        } catch (err) {
            setError(err.message);
        }
    };

    const useEmailInstead = async () => {
        setError('');
        try {
            await api.post('/auth/send-email-code', { userId });
        } catch {
            /* resposta do endpoint e sempre generica, seguimos mesmo assim */
        }
        setStep(2);
    };

    return (
        <div className={`login-scene ${journeyOn ? 'login-scene--on' : ''}`}>
            <ThemeToggle className="login-theme-toggle" />

            {STARS.map((star, i) => (
                <div
                    key={i}
                    className="login-star"
                    style={{ left: `${star.left}%`, top: `${star.top}%`, width: star.size, height: star.size, animationDelay: `${star.delay}s` }}
                />
            ))}

            <div className="login-season-caption">
                <span className="login-tag login-tag-spring"><SeasonIcon season="spring" /> Primavera · 20 anos</span>
                <span className="login-tag login-tag-summer"><SeasonIcon season="summer" /> Verão · 35 anos</span>
                <span className="login-tag login-tag-autumn"><SeasonIcon season="autumn" /> Outono · 50 anos</span>
                <span className="login-tag login-tag-winter"><SeasonIcon season="winter" /> Inverno · 65 anos</span>
            </div>

            <div className="login-season-layer login-layer-spring">
                {BLOSSOMS.map((b, i) => (
                    <div key={i} className="login-blossom" style={{ left: `${b.left}%`, animationDelay: `${b.delay}s` }} />
                ))}
            </div>

            <div className="login-season-layer login-layer-summer">
                <div className="login-summer-glow" />
                <div className="login-heat-line" style={{ left: '20%', animationDelay: '0s' }} />
                <div className="login-heat-line" style={{ left: '48%', animationDelay: '0.8s' }} />
                <div className="login-heat-line" style={{ left: '76%', animationDelay: '1.4s' }} />
            </div>

            <div className="login-season-layer login-layer-autumn">
                {LEAVES.map((l, i) => (
                    <div
                        key={i}
                        className="login-leaf"
                        style={{ left: `${l.left}%`, background: l.color, animationDuration: `${l.dur}s`, animationDelay: `${l.delay}s` }}
                    />
                ))}
            </div>

            <div className="login-season-layer login-layer-winter">
                {SNOW.map((s, i) => (
                    <div
                        key={i}
                        className="login-snow"
                        style={{ left: `${s.left}%`, width: s.size, height: s.size, animationDuration: `${s.dur}s`, animationDelay: `${s.delay}s` }}
                    />
                ))}
            </div>

            <div className="login-peak-burst" />
            <div className="login-conquest-label">Uma vida de conquistas financeiras.</div>

            <svg className="login-chart-track" viewBox="0 0 100 100" preserveAspectRatio="none">
                <path className="login-grid-line" d="M0,33 L100,33" />
                <path className="login-grid-line" d="M0,66 L100,66" />
                <path className="login-guide-line" d={CHART_PATH} />
            </svg>
            <svg className="login-chart-line" viewBox="0 0 100 100" preserveAspectRatio="none">
                <defs>
                    <linearGradient id="loginClimbGradient" x1="0%" y1="100%" x2="40%" y2="0%">
                        <stop offset="0%" stopColor="#10b981" />
                        <stop offset="55%" stopColor="#3b82f6" />
                        <stop offset="100%" stopColor="#e0ab4a" />
                    </linearGradient>
                </defs>
                <path d={CHART_PATH} />
            </svg>

            {DOTS.map((dot, i) => (
                <div key={i} className="login-chart-dot" style={{ left: `${dot.x}%`, top: `${dot.y}%`, transitionDelay: `${dot.delay}ms` }} />
            ))}

            <button type="button" className="login-figure-rig" onClick={toggleJourney} aria-label={journeyOn ? 'Reiniciar a jornada' : 'Viver a jornada financeira até o topo'}>
                <div className="login-figure-halo" />
                <AgingFigures />
            </button>

            {!journeyOn && (
                <>
                    <div className="login-climb-hint">
                        Toque e viva uma jornada financeira inteira
                        <span className="login-climb-hint-arrow">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M18 15l-6-6-6 6" /></svg>
                        </span>
                    </div>
                    <button type="button" className="login-skip" onClick={() => setJourneyOn(true)}>
                        Pular animação
                    </button>
                </>
            )}

            <div className="login-card">
                <Logo size={40} wordmark="Financas" />
                <h2>{step === 1 ? 'Acesso Seguro' : step === 3 ? 'Verificacao por biometria' : 'Verificacao 2FA'}</h2>
                <p>
                    {step === 1
                        ? 'Bem-vindo de volta ao seu controle financeiro.'
                        : step === 3
                        ? 'Use a digital ou o reconhecimento facial deste aparelho para confirmar o acesso.'
                        : newDevice
                        ? 'Novo dispositivo detectado. Confirme com o codigo enviado ao seu e-mail de seguranca.'
                        : 'Insira o codigo enviado para seu e-mail.'}
                </p>

                {step === 1 && (
                    <form onSubmit={handleLogin}>
                        <div className="input-group">
                            <input
                                type="text"
                                placeholder="Usuario"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                required
                            />
                            <input
                                type="password"
                                placeholder="Senha"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                required
                            />
                        </div>
                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? 'Enviando codigo...' : 'Entrar'}
                        </button>
                    </form>
                )}

                {step === 3 && (
                    <div className="input-group">
                        <button
                            type="button"
                            className="btn-primary"
                            onClick={() => tryBiometricLogin(userId)}
                            disabled={biometricPending}
                        >
                            {biometricPending ? 'Aguardando biometria...' : 'Tentar novamente'}
                        </button>
                        <button type="button" className="btn-link" onClick={useEmailInstead}>
                            Usar codigo por e-mail
                        </button>
                    </div>
                )}

                {step === 2 && (
                    <form onSubmit={handleVerify}>
                        <div className="input-group">
                            <input
                                type="text"
                                placeholder="Codigo de 6 digitos"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                maxLength={6}
                                required
                            />
                        </div>
                        <button type="submit" className="btn-primary">Verificar e Acessar</button>
                    </form>
                )}

                {error && <div className="error-msg">{error}</div>}
            </div>

            <div className="login-scene-footer">Seus dados ficam cifrados de ponta a ponta.</div>
        </div>
    );
}
