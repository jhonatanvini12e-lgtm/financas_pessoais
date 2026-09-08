import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import LineChartCard from '../components/charts/LineChartCard.jsx';

export default function TurningPoint() {
    const [data, setData] = useState(null);
    const [error, setError] = useState('');

    useEffect(() => {
        api.get('/investments/turning-point').then(setData).catch((err) => setError(err.message));
    }, []);

    if (error) return <div className="error-msg">{error}</div>;
    if (!data) return <p>Carregando...</p>;

    return (
        <div className="page">
            <h1>Ponto de Virada</h1>
            <p className="muted">
                Projecao de longo prazo comparando o retorno acumulado dos investimentos com os juros acumulados pagos nas dividas.
            </p>

            <section className="card">
                {data.turningPointMonth ? (
                    <p className="budget-alert-ok">
                        No mes {data.turningPointMonth} da projecao, o retorno dos investimentos passa a superar os juros pagos nas dividas.
                    </p>
                ) : (
                    <p className="muted">Sem cruzamento projetado no horizonte simulado — ajuste aporte ou quite mais dividas.</p>
                )}

                <LineChartCard
                    data={data.series}
                    xKey="month"
                    lines={[
                        { key: 'cumulativeInvestmentReturn', name: 'Retorno acumulado (investimentos)', color: '#06b6d4' },
                        { key: 'cumulativeDebtInterest', name: 'Juros acumulados (dividas)', color: '#ef4444' },
                    ]}
                    height={360}
                />
            </section>
        </div>
    );
}
