/**
 * cartao.ts — Interfaces TypeScript para o módulo de cartões de crédito.
 */

/** Estado de pagamento de uma parcela do cartão. */
export type SituacaoLancamento = 'pago' | 'pendente';

/** Estado da aprovação de divisão de um lançamento. */
export type StatusDivisaoCartao = 'aguardando' | 'de_acordo' | 'negado';

/** Cartão de crédito do usuário. */
export interface Cartao {
  id:         number;
  usuario_id: number;
  banco:      string;
  limite:     number;
  fechamento: number;  // dia 1–31
  vencimento: number;  // dia 1–31
  ativo:      boolean;
  criado_em:  string;
}

/** Payload para criar ou editar um cartão. */
export interface EntradaCartao {
  banco:      string;
  limite:     number;
  fechamento: number;
  vencimento: number;
}

/** Lançamento de um cartão, enriquecido com dados da parcela do mês solicitado. */
export interface LancamentoFatura {
  id:                   number;
  cartao_id:            number;
  descricao:            string;
  valor_parcela:        number;
  parcela_atual:        number;   // qual parcela cai no mês solicitado
  parcela_total:        number;   // total de parcelas (parcela_final - parcela_inicial + 1)
  data_compra:          string;   // "YYYY-MM-DD"
  data_vencimento:      string;   // "YYYY-MM-DD" — vencimento desta parcela
  situacao:             SituacaoLancamento;
  dividido_email:       string | null;
  dividido_porcentagem: number | null;
  divisao_status:       StatusDivisaoCartao | null;
  criado_em:            string;
}

/** Payload para criar ou editar um lançamento. */
export interface EntradaLancamento {
  descricao:            string;
  valor_parcela:        number;
  parcela_inicial:      number;
  parcela_final:        number;
  data_compra:          string;
  situacao:             SituacaoLancamento;
  dividido_email?:      string;
  dividido_porcentagem?: number;
}

/** Totais da fatura de um mês. */
export interface ResumoFatura {
  total:      number;
  pago:       number;
  pendente:   number;
  quantidade: number;
}

/** Lançamento de cartão aguardando aprovação do usuário convidado. */
export interface CartaoLancamentoPendente {
  lancamento_id:      number;
  cartao_banco:       string;
  descricao:          string;
  valor_parcela:      number;
  minha_parte:        number;    // valor_parcela × porcentagem/100
  minha_porcentagem:  number;
  parcela_atual:      number;
  parcela_total:      number;
  data_compra:        string;
  data_vencimento:    string | null;
}
