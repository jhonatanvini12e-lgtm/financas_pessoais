import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useTheme } from '../../context/ThemeContext.jsx';

export default function BarChartCard({ title, data, xKey, bars, height = 280 }) {
    const { theme } = useTheme();
    const isLight = theme === 'light';
    const gridColor = isLight ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.08)';
    const axisColor = isLight ? '#5b6472' : '#94a3b8';
    const tooltipBg = isLight ? '#ffffff' : '#131929';
    const tooltipBorder = isLight ? '1px solid rgba(15,23,42,0.12)' : '1px solid rgba(148,163,184,0.18)';

    return (
        <div className="chart-card">
            {title && <h3>{title}</h3>}
            <ResponsiveContainer width="100%" height={height}>
                <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                    <XAxis dataKey={xKey} stroke={axisColor} fontSize={12} />
                    <YAxis stroke={axisColor} fontSize={12} />
                    <Tooltip contentStyle={{ background: tooltipBg, border: tooltipBorder, borderRadius: 10 }} />
                    <Legend />
                    {bars.map((bar) => (
                        <Bar key={bar.key} dataKey={bar.key} name={bar.name || bar.key} fill={bar.color} radius={[4, 4, 0, 0]} />
                    ))}
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}
