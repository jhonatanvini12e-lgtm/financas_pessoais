import db from '../db/index.js';

// Motor de regras por palavra-chave: casa a descricao da transacao contra a
// lista de keywords (separadas por virgula) de cada categoria do usuario.
// A primeira categoria com uma keyword encontrada na descricao (case-insensitive,
// substring) vence. Categorias sem keywords sao ignoradas na auto-categorizacao.

// Extratos de banco/fatura raramente tem descricao "legivel" (ex: nome de
// categoria de estabelecimento) -- vem so o nome cru do estabelecimento/pagador
// ("LONDRISUL TRANSPORTE C", "MARCIOLOPESLEAL"), que nao bate com nenhuma
// keyword generica. Em vez de depender so de keywords cadastradas na mao,
// aprendemos com o proprio historico: se o usuario ja categorizou (manualmente
// ou via regra) um lancamento com a mesma descricao antes, reaproveitamos essa
// categoria da proxima vez que a mesma descricao aparecer.
function normalizeForMatch(description) {
    return String(description ?? '')
        .toLowerCase()
        // remove o contador de parcela ("(8/12)") pra que todas as parcelas
        // do mesmo lancamento parcelado contem como a mesma descricao base.
        .replace(/\s*\(\d{1,2}\/\d{1,2}\)\s*$/, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Construido uma vez por lote (importacao/sync) em vez de re-escanear a
// tabela inteira a cada lancamento -- ver rotas que chamam categorize() em loop.
export function buildCategoryLearningMap(userId) {
    const rows = db
        .prepare(
            `SELECT description, category_id
             FROM transactions
             WHERE user_id = ? AND category_id IS NOT NULL AND description IS NOT NULL`
        )
        .all(userId);

    const countsByKey = new Map();
    for (const row of rows) {
        const key = normalizeForMatch(row.description);
        if (!key) continue;
        const counts = countsByKey.get(key) || new Map();
        counts.set(row.category_id, (counts.get(row.category_id) || 0) + 1);
        countsByKey.set(key, counts);
    }

    const bestByKey = new Map();
    for (const [key, counts] of countsByKey) {
        let bestId = null;
        let bestCount = 0;
        for (const [categoryId, count] of counts) {
            if (count > bestCount) {
                bestCount = count;
                bestId = categoryId;
            }
        }
        bestByKey.set(key, bestId);
    }
    return bestByKey;
}

// Construido uma vez por lote, no mesmo espirito de buildCategoryLearningMap:
// evita reconsultar a tabela categories a cada chamada de categorize() dentro
// de um loop (ver rotas de import/recategorize que passam isso adiante).
export function buildCategoryKeywordList(userId) {
    return db
        .prepare("SELECT id, keywords FROM categories WHERE user_id = ? AND keywords IS NOT NULL AND keywords != ''")
        .all(userId);
}

// `learningMap` e `categoriesWithKeywords` sao opcionais (recalculados a
// partir do banco se omitidos) -- passe versoes pre-construidas ao
// categorizar varios lancamentos em lote.
export function categorize(userId, description, learningMap, categoriesWithKeywords) {
    if (!description) return null;

    const normalizedKey = normalizeForMatch(description);
    const map = learningMap || buildCategoryLearningMap(userId);
    const learnedCategoryId = map.get(normalizedKey);
    if (learnedCategoryId != null) return learnedCategoryId;

    const normalizedDescription = description.toLowerCase();
    const categories = categoriesWithKeywords || buildCategoryKeywordList(userId);

    for (const category of categories) {
        const keywords = category.keywords.split(',').map((k) => k.trim().toLowerCase()).filter(Boolean);
        if (keywords.some((keyword) => normalizedDescription.includes(keyword))) {
            return category.id;
        }
    }

    return null;
}
