import { useEffect, useId, useState } from 'react';

const TONE_STOPS = {
    brand: ['var(--accent-bright)', 'var(--accent-blue)'],
    warning: ['var(--warning)', 'var(--warning)'],
    positive: ['var(--positive)', 'var(--positive)'],
    critical: ['var(--negative)', 'var(--negative)'],
};

// Anel de progresso em SVG puro (sem libs) -- o traco anima de 0 ate `ratio`
// no mount via requestAnimationFrame, mesma ideia do @keyframes growIn usado
// no ProgressBar linear, e respeita prefers-reduced-motion porque a regra
// global `*` em index.css zera a duration de qualquer transition/animation.
export default function RingProgress({ ratio, size = 112, strokeWidth = 11, tone = 'brand', label, sublabel }) {
    const gradientId = useId();
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const clamped = Math.min(Math.max(ratio || 0, 0), 1);

    const [offset, setOffset] = useState(circumference);
    useEffect(() => {
        const frame = requestAnimationFrame(() => setOffset(circumference * (1 - clamped)));
        return () => cancelAnimationFrame(frame);
    }, [circumference, clamped]);

    const [stopFrom, stopTo] = TONE_STOPS[tone] || TONE_STOPS.brand;

    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="ring-progress">
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" strokeWidth={strokeWidth} style={{ stroke: 'var(--border-glass-strong)' }} />
            <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                className="ring-progress-fill"
                style={{ stroke: `url(#${gradientId})` }}
            />
            <defs>
                <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style={{ stopColor: stopFrom }} />
                    <stop offset="100%" style={{ stopColor: stopTo }} />
                </linearGradient>
            </defs>
            <text x="50%" y="50%" dy={sublabel ? -3 : 0} textAnchor="middle" dominantBaseline="middle" className="ring-progress-value">
                {label}
            </text>
            {sublabel && (
                <text x="50%" y="50%" dy={17} textAnchor="middle" dominantBaseline="middle" className="ring-progress-sublabel">
                    {sublabel}
                </text>
            )}
        </svg>
    );
}
