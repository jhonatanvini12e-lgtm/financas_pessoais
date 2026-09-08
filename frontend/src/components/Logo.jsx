// Selo da marca: barras em ascensao (o mesmo elemento do dashboard) com um
// no de destaque no topo da barra mais alta. Ver design em src/index.css
// (--accent-cyan / --accent-purple) -- a marca nao usa nenhuma cor nova.
export function LogoMark({ size = 32 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 64 64" fill="none" role="img" aria-label="Financas Pessoais">
            <defs>
                <linearGradient id="logo-mark-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" stopColor="#06b6d4" />
                    <stop offset="100%" stopColor="#8b5cf6" />
                </linearGradient>
            </defs>
            <rect width="64" height="64" rx="16" fill="url(#logo-mark-gradient)" />
            <circle cx="45" cy="6.5" r="4" fill="#f8fafc" />
            <rect x="15" y="30" width="8" height="19" rx="2" fill="#f8fafc" fillOpacity="0.55" />
            <rect x="28" y="22" width="8" height="27" rx="2" fill="#f8fafc" fillOpacity="0.78" />
            <rect x="41" y="12" width="8" height="37" rx="2" fill="#f8fafc" />
        </svg>
    );
}

export default function Logo({ size = 32, wordmark = 'Financas', className = '' }) {
    return (
        <span className={`logo-lockup ${className}`}>
            <LogoMark size={size} />
            {wordmark && <span className="logo-word">{wordmark}</span>}
        </span>
    );
}
