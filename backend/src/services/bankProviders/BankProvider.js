// Interface que qualquer provider de Open Finance deve implementar.
// Para plugar um agregador real (ex: Pluggy, Belvo) no futuro, crie uma nova
// classe implementando os mesmos metodos e troque a instancia usada em
// bankProviders/index.js -- nenhuma rota ou servico precisa mudar.
export class BankProvider {
    /**
     * @param {string} providerKey - 'nubank' | 'inter' | 'santander' | 'mercadopago'
     * @returns {Promise<{ balance: number, transactions: Array<{fitid:string,date:string,amount:number,description:string}> }>}
     */
    async sync(providerKey) {
        throw new Error('sync() nao implementado');
    }
}
