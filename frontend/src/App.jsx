import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Accounts from './pages/Accounts.jsx';
import InvoiceExport from './pages/InvoiceExport.jsx';
import OfxImportWizard from './pages/OfxImportWizard.jsx';
import Transactions from './pages/Transactions.jsx';
import QuickAdd from './pages/QuickAdd.jsx';
import Categories from './pages/Categories.jsx';
import Budget from './pages/Budget.jsx';
import Debts from './pages/Debts.jsx';
import CaixinhasInvestimentos from './pages/CaixinhasInvestimentos.jsx';
import TurningPoint from './pages/TurningPoint.jsx';
import Intelligence from './pages/Intelligence.jsx';
import Alerts from './pages/Alerts.jsx';
import Settings from './pages/Settings.jsx';

function App() {
    const { token, loadingUser } = useAuth();

    if (!token) return <Login />;
    if (loadingUser) return <p>Carregando...</p>;

    return (
        <Routes>
            <Route element={<Layout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/quick-add" element={<QuickAdd />} />
                <Route path="/accounts" element={<Accounts />} />
                <Route path="/invoice-export" element={<InvoiceExport />} />
                <Route path="/ofx-import" element={<OfxImportWizard />} />
                <Route path="/transactions" element={<Transactions />} />
                <Route path="/categories" element={<Categories />} />
                <Route path="/budget" element={<Budget />} />
                <Route path="/debts" element={<Debts />} />
                <Route path="/caixinhas-investimentos" element={<CaixinhasInvestimentos />} />
                <Route path="/envelopes" element={<Navigate to="/caixinhas-investimentos" replace />} />
                <Route path="/investments" element={<Navigate to="/caixinhas-investimentos" replace />} />
                <Route path="/banks" element={<Navigate to="/invoice-export" replace />} />
                <Route path="/turning-point" element={<TurningPoint />} />
                <Route path="/intelligence" element={<Intelligence />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
        </Routes>
    );
}

export default App;
