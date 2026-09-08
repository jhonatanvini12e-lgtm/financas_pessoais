function levelFromRatio(ratio) {
    if (ratio >= 1) return 'critical';
    if (ratio >= 0.8) return 'warning';
    return 'ok';
}

export default function ProgressBar({ ratio, label }) {
    const clamped = Math.min(Math.max(ratio, 0), 1.5);
    const level = levelFromRatio(ratio);

    return (
        <div className="progress-wrap">
            {label && (
                <div className="progress-label">
                    <span>{label}</span>
                    <span>{(ratio * 100).toFixed(0)}%</span>
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
