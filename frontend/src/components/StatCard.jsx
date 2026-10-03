export default function StatCard({ label, value, hint, tone = 'default', icon }) {
    return (
        <div className={`stat-card stat-${tone}`}>
            {icon && <div className="stat-icon">{icon}</div>}
            <span className="stat-label">{label}</span>
            <span className="stat-value">{value}</span>
            {hint && <span className="stat-hint">{hint}</span>}
        </div>
    );
}
