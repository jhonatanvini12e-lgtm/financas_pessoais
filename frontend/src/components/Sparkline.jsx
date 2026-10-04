import { useId } from 'react';

// Mini grafico de linha/area em SVG puro, sem eixos -- usado em cards
// pequenos (saldo, fluxo de caixa) onde um LineChartCard do recharts seria
// peso demais. Anima com o mesmo fadeIn global (ver .sparkline em index.css).
export default function Sparkline({ values, color = 'var(--accent-blue)', height = 56, width = 400 }) {
    const gradientId = useId();
    if (!values || values.length < 2) return null;

    const max = Math.max(...values);
    const min = Math.min(...values);
    const range = max - min || 1;
    const stepX = width / (values.length - 1);
    const points = values.map((v, i) => [i * stepX, height - ((v - min) / range) * height]);
    const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
    const areaPath = `${linePath} L${width} ${height} L0 ${height} Z`;

    return (
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="sparkline">
            <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.32 }} />
                    <stop offset="100%" style={{ stopColor: color, stopOpacity: 0 }} />
                </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
            <path d={linePath} fill="none" style={{ stroke: color }} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    );
}
