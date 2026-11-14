function levelFromRatio(ratio) {
    if (ratio >= 1) return 'critical';
    if (ratio >= 0.8) return 'warning';
    return 'ok';
}

// ratio === null significa "sem limite definido" (ex: categoria com
// budget_limit 0) -- nesse caso nao da pra calcular % de nada, e mostrar
// "0%"/barra vazia enganaria o usuario fazendo parecer que nao houve gasto
// algum. Mostramos uma barra neutra cheia + "Sem limite" em vez de %.
export default function ProgressBar({ ratio, label }) {
    const unlimited = ratio == null;
    const clamped = unlimited ? 1 : Math.min(Math.max(ratio, 0), 1.5);
    const level = unlimited ? 'neutral' : levelFromRatio(ratio);

    return (
        <div className="progress-wrap">
            {label && (
                <div className="progress-label">
                    <span>{label}</span>
                    <span>{unlimited ? 'Sem limite' : `${(ratio * 100).toFixed(0)}%`}</span>
                </div>
            )}
            <div className="progress-track">
                <div
                    className={`progress-fill progress-${level}`}
                    style={{ width: `${Math.min(clamped * 100, 100)}%` }}
                />
            </div>
        </div>
    );
}
