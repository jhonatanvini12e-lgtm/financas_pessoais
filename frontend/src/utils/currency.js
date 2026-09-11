export function formatCurrency(value, hideValues) {
    return hideValues ? '••••••' : `R$ ${Number(value || 0).toFixed(2)}`;
}
