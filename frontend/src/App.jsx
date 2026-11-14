import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Accounts from './pages/Accounts.jsx';
import OfxImportWizard from './pages/OfxImportWizard.jsx';
import Transactions from './pages/Transactions.jsx';
import QuickAdd from './pages/QuickAdd.jsx';
import Categories from './pages/Categories.jsx';
import Budget from './pages/Budget.jsx';
import NotasFaturas from './pages/NotasFaturas.jsx';
import CaixinhasInvestimentos from './pages/CaixinhasInvestimentos.jsx';
import Analytics from './pages/Analytics.jsx';
import Alerts from './pages/Alerts.jsx';
import Settings from './pages/Settings.jsx';

function App() {
    const { user, loadingUser } = useAuth();

    if (loadingUser) return <p>Carregando...</p>;
    if (!user) return <Login />;

    return (
        <Routes>
            <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/quick-add" element={<QuickAdd />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/invoice-export" element={<Navigate to="/notas-faturas?tab=exportacao-fatura" replace />} />
                <Route path="/ofx-import" element={<OfxImportWizard />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/categories" element={<Categories />} />
                <Route path="/budget" element={<Budget />} />
                <Route path="/debts" element={<Navigate to="/notas-faturas?tab=dividas" replace />} />
                <Route path="/bills" element={<Navigate to="/notas-faturas?tab=contas-a-pagar" replace />} />
                <Route path="/notas-faturas" element={<NotasFaturas />} />
                <Route path="/caixinhas-investimentos" element={<CaixinhasInvestimentos />} />
                <Route path="/envelopes" element={<Navigate to="/caixinhas-investimentos" replace />} />
                <Route path="/investments" element={<Navigate to="/caixinhas-investimentos" replace />} />
                <Route path="/banks" element={<Navigate to="/notas-faturas?tab=exportacao-fatura" replace />} />
                <Route path="/turning-point" element={<Navigate to="/analytics?tab=ponto-de-virada" replace />} />
                <Route path="/intelligence" element={<Navigate to="/analytics?tab=inteligencia" replace />} />
                <Route path="/analytics" element={<Analytics />} />
                <Route path="/connections" element={<Navigate to="/accounts?tab=conexoes" replace />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    );
}

export default App;
