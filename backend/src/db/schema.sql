CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    email TEXT NOT NULL,
    last_login DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    household_id INTEGER REFERENCES users(id)
);

-- last_email_verified_at marca a ultima vez que o codigo por e-mail foi
-- verificado com sucesso neste dispositivo -- usado pelo login com
-- biometria (webauthn_credentials) para so pedir o e-mail de novo depois de
-- webauthnEmailRecheckDays (ver budgetParams.js), em vez de a cada login.
CREATE TABLE IF NOT EXISTS known_devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    label TEXT,
    last_seen DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_email_verified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    UNIQUE(user_id, fingerprint)
);

-- Uma linha por passkey (biometria/Touch ID/Face ID) registrada para um
-- usuario. device_fingerprint prende a credencial ao mesmo par
-- User-Agent+IP usado em known_devices, para que o login com biometria so
-- seja oferecido nesse dispositivo especifico (nao a conta toda).
CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_id TEXT UNIQUE NOT NULL,
    public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0,
    device_fingerprint TEXT NOT NULL,
    transports TEXT,
    label TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,
    FOREIGN KEY(user_id) REFERENCES users(id)
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
    created_by INTEGER,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(account_id) REFERENCES accounts(id),
    FOREIGN KEY(card_id) REFERENCES credit_cards(id),
    FOREIGN KEY(category_id) REFERENCES categories(id),
    FOREIGN KEY(created_by) REFERENCES users(id)
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

-- Reforca a nivel de banco o "uma por (card_id, due_date)" comentado acima --
-- registerCardInvoiceFromImport ja faz esse dedup na aplicacao, mas isso e'
-- so' um SELECT-then-INSERT (nao atomico) sem nenhuma garantia no schema; o
-- indice parcial (so' cobre linhas de fatura, card_id IS NOT NULL) evita que
-- qualquer bug futuro nesse fluxo duplique silenciosamente a mesma fatura.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bills_card_due_date ON bills(card_id, due_date) WHERE card_id IS NOT NULL;

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

-- Notas fiscais (NF-e modelo 55 / NFC-e modelo 65) que o usuario importa --
-- NAO ha API publica que entregue "todas as notas de um CPF": a pessoa
-- alimenta via upload de XML ou cadastro da chave de acesso (ver
-- services/fiscalNotes/ e routes/fiscalNotes.js). access_key (a chave de 44
-- digitos) e' o identificador unico da nota na SEFAZ e serve de dedup natural
-- -- por isso e' UNIQUE. Notas cadastradas so pela chave (sem XML) ficam com
-- os demais campos em NULL ate alguem anexar o XML correspondente.
CREATE TABLE IF NOT EXISTS fiscal_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    access_key TEXT UNIQUE,
    model TEXT,
    number TEXT,
    series TEXT,
    issuer_name TEXT,
    issuer_cnpj TEXT,
    recipient_name TEXT,
    recipient_cpf TEXT,
    issue_date TEXT,
    total_amount REAL,
    xml_raw TEXT,
    source TEXT NOT NULL DEFAULT 'xml',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Vinculo entre um cartao local e uma conta de cartao de credito na Pluggy
-- (Open Finance via Meu Pluggy, ver services/pluggySyncService.js). A sync
-- so mexe em lancamentos com data >= sync_from -- o que veio antes disso
-- (ex: faturas ja importadas por arquivo) fica intocado. created_by e quem
-- aparece como "quem realizou o gasto" nos lancamentos sincronizados.
-- pluggy_item_id identifica de qual conexao (item) da Pluggy a conta veio --
-- necessario pra saber qual client_id/secret usar quando ha mais de uma
-- conta Meu Pluggy configurada (uma por CPF/titular, ver pluggyClient.js).
CREATE TABLE IF NOT EXISTS pluggy_card_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    card_id INTEGER NOT NULL UNIQUE,
    pluggy_account_id TEXT NOT NULL UNIQUE,
    pluggy_item_id TEXT,
    created_by INTEGER NOT NULL,
    sync_from TEXT NOT NULL,
    last_sync_at DATETIME,
    last_sync_status TEXT,
    last_sync_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(card_id) REFERENCES credit_cards(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id)
);

-- Historico de execucoes da sync da Pluggy (uma linha por cartao por
-- execucao), para a tela de monitoramento de conexoes. Mantemos so as
-- ultimas execucoes de cada vinculo (ver pluggySyncService.recordRun).
CREATE TABLE IF NOT EXISTS pluggy_sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    trigger TEXT CHECK(trigger IN ('CRON', 'MANUAL', 'LINK')) NOT NULL,
    status TEXT CHECK(status IN ('OK', 'ERROR')) NOT NULL,
    started_at DATETIME NOT NULL,
    duration_ms INTEGER,
    remote_count INTEGER,
    inserted INTEGER DEFAULT 0,
    updated INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    bills_registered INTEGER DEFAULT 0,
    message TEXT,
    FOREIGN KEY(link_id) REFERENCES pluggy_card_links(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pluggy_sync_runs_link ON pluggy_sync_runs(link_id, started_at);

-- Vinculo entre uma conta local e uma conta corrente/poupanca na Pluggy
-- (Open Finance via Meu Pluggy, ver services/pluggySyncService.js). Mesma
-- ideia de pluggy_card_links, mas para accounts: a sync so mexe em
-- lancamentos com data >= sync_from.
CREATE TABLE IF NOT EXISTS pluggy_account_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER NOT NULL UNIQUE,
    pluggy_account_id TEXT NOT NULL UNIQUE,
    pluggy_item_id TEXT,
    created_by INTEGER NOT NULL,
    sync_from TEXT NOT NULL,
    last_sync_at DATETIME,
    last_sync_status TEXT,
    last_sync_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY(created_by) REFERENCES users(id)
);

-- Historico de execucoes da sync da Pluggy para contas (ver pluggy_sync_runs,
-- equivalente para cartoes). Sem bills_registered: conta corrente nao tem
-- fatura.
CREATE TABLE IF NOT EXISTS pluggy_account_sync_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    trigger TEXT CHECK(trigger IN ('CRON', 'MANUAL', 'LINK')) NOT NULL,
    status TEXT CHECK(status IN ('OK', 'ERROR')) NOT NULL,
    started_at DATETIME NOT NULL,
    duration_ms INTEGER,
    remote_count INTEGER,
    inserted INTEGER DEFAULT 0,
    updated INTEGER DEFAULT 0,
    deleted INTEGER DEFAULT 0,
    message TEXT,
    FOREIGN KEY(link_id) REFERENCES pluggy_account_links(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_pluggy_account_sync_runs_link ON pluggy_account_sync_runs(link_id, started_at);

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

CREATE TABLE IF NOT EXISTS alert_preferences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    -- Gasto acima de limite por categoria (semanal)
    cat_spending_enabled INTEGER DEFAULT 0,
    cat_spending_threshold REAL DEFAULT 500,
    -- Total mensal acima de teto
    monthly_ceiling_enabled INTEGER DEFAULT 0,
    monthly_ceiling_amount REAL DEFAULT 5000,
    -- Compra acima de valor especifico
    large_purchase_enabled INTEGER DEFAULT 0,
    large_purchase_amount REAL DEFAULT 200,
    -- Fatura chegando perto do vencimento (dias antes)
    card_due_enabled INTEGER DEFAULT 1,
    card_due_days INTEGER DEFAULT 2,
    -- Fatura ultrapassando valor
    card_invoice_limit_enabled INTEGER DEFAULT 0,
    card_invoice_limit_amount REAL DEFAULT 1000,
    -- Saldo abaixo de valor minimo
    low_balance_enabled INTEGER DEFAULT 0,
    low_balance_amount REAL DEFAULT 500,
    -- Entrada ou saida relevante na conta
    relevant_tx_enabled INTEGER DEFAULT 0,
    relevant_tx_amount REAL DEFAULT 100,
    -- Resumo diario
    daily_summary_enabled INTEGER DEFAULT 0,
    -- Resumo semanal (dia da semana: 0=dom...6=sab)
    weekly_summary_enabled INTEGER DEFAULT 0,
    weekly_summary_day INTEGER DEFAULT 1,
    -- Resumo mensal (dia do mes: 1-28)
    monthly_summary_enabled INTEGER DEFAULT 0,
    monthly_summary_day INTEGER DEFAULT 1,
    -- Comparativo com periodo anterior (mensal, no 1o do mes)
    period_comparison_enabled INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
);
