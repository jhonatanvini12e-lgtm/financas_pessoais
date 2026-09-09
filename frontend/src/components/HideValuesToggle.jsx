import { usePrivacy } from '../context/PrivacyContext.jsx';

export default function HideValuesToggle({ className = '' }) {
    const { hideValues, toggleHideValues } = usePrivacy();

    return (
        <button
            type="button"
            className={`hide-values-toggle ${className}`}
            onClick={toggleHideValues}
            aria-label={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
            title={hideValues ? 'Mostrar valores' : 'Ocultar valores'}
        >
            {hideValues ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-10-8-10-8a18.5 18.5 0 0 1 4.22-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88" />
                    <path d="M2 2l20 20" />
                </svg>
            ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8Z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
            )}
            <span className="hide-values-toggle-label">{hideValues ? 'Mostrar valores' : 'Ocultar valores'}</span>
        </button>
    );
}
