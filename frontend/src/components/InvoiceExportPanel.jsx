import { Link } from 'react-router-dom';

// Nao ha sync automatico com banco (Open Finance exige credenciamento como
// participante junto ao Banco Central, que pessoa fisica nao consegue
// obter). Esta tela existe so para orientar o usuario a exportar a
// fatura/extrato manualmente do app/site do banco ou cartao e trazer pro
// assistente de importacao -- unico caminho de entrada de lancamentos em
// lote no app.
export default function InvoiceExport() {
    return (
        <div className="page">
            <h1>Exportacao de Fatura</h1>
            <p className="muted">
                Nao ha sincronizacao automatica com bancos ou cartoes. Exporte a fatura ou o extrato pelo app/site do
                seu banco ou cartao (.ofx, .csv, .xlsx ou .pdf) e importe pelo assistente abaixo.
            </p>

            <section className="card">
                <h2>Como importar</h2>
                <p>Use o assistente guiado de importacao manual de extratos e faturas.</p>
                <Link className="btn-primary" to="/ofx-import" style={{ marginTop: 12 }}>Abrir assistente de importacao</Link>
            </section>
        </div>
    );
}
