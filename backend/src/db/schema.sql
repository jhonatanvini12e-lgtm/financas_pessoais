CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT NOT NULL,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS known_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    label TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    jti TEXT UNIQUE NOT NULL,
    device_fingerprint TEXT,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    revoked INTEGER DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    bank_name TEXT NOT NULL,
    provider TEXT,
    balance REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS credit_cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    card_name TEXT NOT NULL,
    credit_limit REAL NOT NULL,
    closing_day INTEGER NOT NULL,
    due_day INTEGER NOT NULL,
    provider TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    name TEXT NOT NULL,
    type TEXT CHECK(type IN ('INCOME', 'EXPENSE')) NOT NULL,
    keywords TEXT,
    budget_limit REAL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER,
    card_id INTEGER,
    category_id INTEGER,
    amount REAL NOT NULL,
    date DATETIME NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'PENDING',
    external_fitid TEXT,
    source TEXT DEFAULT 'MANUAL',
    installment_group TEXT,
    installment_number INTEGER,
    installment_total INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(account_id) REFERENCES accounts(id),
    FOREIGN KEY(card_id) REFERENCES credit_cards(id),
    FOREIGN KEY(category_id) REFERENCES categories(id)
);

-- Auditoria de alteracoes/remocoes em transactions (valores antes/depois em
-- JSON). Sem FK para transactions(id): o registro de um DELETE precisa
-- sobreviver depois que a linha original deixa de existir.
CREATE TABLE IF NOT EXISTS transaction_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transaction_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    action TEXT CHECK(action IN ('UPDATE', 'DELETE')) NOT NULL,
    before_data TEXT NOT NULL,
    after_data TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ofx_imports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER,
    card_id INTEGER,
    filename TEXT,
    imported_count INTEGER DEFAULT 0,
    skipped_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS envelopes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT DEFAULT 'CUSTOM',
    target_amount REAL DEFAULT 0,
    current_amount REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS envelope_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    envelope_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    type TEXT CHECK(type IN ('DEPOSIT', 'WITHDRAW')) NOT NULL,
    note TEXT,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(envelope_id) REFERENCES envelopes(id)
);

-- recurring=1 (padrao): conta fixa que repete todo mes no dia due_day
-- (aluguel, agua, luz, assinaturas). recurring=0: conta avulsa com data unica
-- em due_date, nao repete depois de paga. card_id marca uma linha gerada
-- automaticamente pela importacao de fatura (ver billsService.registerCardInvoiceFromImport) --
-- uma por (card_id, due_date), para nao duplicar a mesma fatura ao reimportar.
CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    category_id INTEGER,
    expected_amount REAL DEFAULT 0,
    due_day INTEGER,
    recurring INTEGER DEFAULT 1,
    due_date TEXT,
    card_id INTEGER,
    active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(card_id) REFERENCES credit_cards(id),
    FOREIGN KEY(category_id) REFERENCES categories(id)
);

-- Uma linha por mes (period = 'YYYY-MM') em que a conta foi marcada como paga.
-- Ausencia de linha para o mes corrente = pendente ou atrasada (calculado em
-- billsService a partir de due_day vs a data atual).
CREATE TABLE IF NOT EXISTS bill_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    amount_paid REAL,
    paid_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(bill_id) REFERENCES bills(id),
    UNIQUE(bill_id, period)
);

-- Mesma ideia de bill_payments, mas para faturas de cartao (que sao virtuais --
-- calculadas em cardService a partir das transacoes -- entao precisam de uma
-- tabela propria para guardar so o "paguei essa fatura" por periodo).
CREATE TABLE IF NOT EXISTS card_invoice_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    card_id INTEGER NOT NULL,
    period TEXT NOT NULL,
    amount_paid REAL,
    paid_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(card_id) REFERENCES credit_cards(id),
    UNIQUE(card_id, period)
);

CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    creditor TEXT,
    principal REAL NOT NULL,
    current_balance REAL NOT NULL,
    interest_rate_monthly REAL NOT NULL,
    minimum_payment REAL NOT NULL,
    due_day INTEGER,
    status TEXT DEFAULT 'OPEN',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS debt_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    debt_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    date DATETIME DEFAULT CURRENT_TIMESTAMP,
    note TEXT,
    FOREIGN KEY(debt_id) REFERENCES debts(id)
);

CREATE TABLE IF NOT EXISTS investments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    name TEXT NOT NULL,
    amount_invested REAL NOT NULL,
    current_value REAL NOT NULL,
    expected_monthly_return_rate REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS investment_goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    target_amount REAL NOT NULL,
    target_date DATE,
    priority INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    severity TEXT DEFAULT 'INFO',
    message TEXT NOT NULL,
    read INTEGER DEFAULT 0,
    emailed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS backups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    size_bytes INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
