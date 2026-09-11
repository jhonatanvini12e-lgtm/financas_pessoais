import { Component } from 'react';

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false };
    }

    static getDerivedStateFromError() {
        return { hasError: true };
    }

    componentDidCatch(error, info) {
        console.error('ErrorBoundary caught an error:', error, info);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div className="page">
                    <div className="card">
                        <h1>Ocorreu um erro inesperado.</h1>
                        <button type="button" className="btn-primary" onClick={() => window.location.reload()}>
                            Recarregar pagina
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
