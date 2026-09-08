import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import LineChartCard from '../components/charts/LineChartCard.jsx';
import BarChartCard from '../components/charts/BarChartCard.jsx';

export default function Intelligence() {
    const [data3, setData3] = useState(null);
    const [data6, setData6] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        api.get('/transactions/compare?months=3').then(setData3).catch((err) => setError(err.message));
        api.get('/transactions/compare?months=6').then(setData6).catch(() => {});
    }, []);

    if (error) return <div className="error-msg">{error}</div>;
    if (!data3 || !data6) return <p>Carregando...</p>;

    return (
        <div className="page">
            <h1>Inteligencia Financeira</h1>

            <div className="two-col">
                <LineChartCard
                    title="Ultimos 3 meses"
                    data={data3.monthly}
                    xKey="month"
                    lines={[
                        { key: 'income', name: 'Receita', color: '#22c55e' },
                        { key: 'expense', name: 'Despesa', color: '#ef4444' },
                    ]}
                />
                <LineChartCard
                    title="Ultimos 6 meses"
                    data={data6.monthly}
                    xKey="month"
                    lines={[
                        { key: 'income', name: 'Receita', color: '#22c55e' },
                        { key: 'expense', name: 'Despesa', color: '#ef4444' },
                    ]}
                />
            </div>

            <div className="two-col">
                <BarChartCard
                    title="Gastos por categoria (3 meses)"
                    data={data3.byCategory}
                    xKey="category"
                    bars={[{ key: 'total', name: 'Total', color: '#8b5cf6' }]}
                />
                <BarChartCard
                    title="Gastos por categoria (6 meses)"
                    data={data6.byCategory}
                    xKey="category"
                    bars={[{ key: 'total', name: 'Total', color: '#06b6d4' }]}
                />
            </div>
        </div>
    );
}
