/**
 * despesa.ts — Interfaces de dados de despesas e divisão.
 * Espelha os schemas Pydantic definidos em rotas/despesas.py.
 */

/** Frequência de repetição de uma despesa */
export type RecorrenciaTipo =
  | 'nao' | 'diario' | 'semanal' | 'quinzenal'
  | 'mensal' | 'trimestral' | 'semestral' | 'anual';

/** Estado de pagamento */
export type SituacaoDespesa = 'pago' | 'pendente';

/** Estado da aprovação de divisão */
export type StatusDivisao = 'aguardando' | 'de_acordo' | 'negado';

/** Labels legíveis da recorrência */
export const ROTULOS_RECORRENCIA: Record<RecorrenciaTipo, string> = {
  nao:         'Não repete',
  diario:      'Diário',
  semanal:     'Semanal',
  quinzenal:   'Quinzenal',
  mensal:      'Mensal',
  trimestral:  'Trimestral',
  semestral:   'Semestral',
  anual:       'Anual',
};

/** Divisão de uma despesa com outro usuário */
export interface DespesaDivisao {
  id: number;
  despesa_id: number;
  email_convidado: string;
  porcentagem: number;
  status: StatusDivisao;
  justificativa_negacao?: string;
  confirmado_em?: string;
}

/** Despesa completa retornada pela API */
export interface Despesa {
  id: number;
  usuario_id: number;
  descricao: string;
  valor: number;
  data: string;         // ISO date string "YYYY-MM-DD"
  recorrente: RecorrenciaTipo;
  comprovante_url?: string;
  situacao: SituacaoDespesa;
  divisao?: DespesaDivisao;
  criado_em: string;
}

/** Despesa pendente de aprovação (para o modal bloqueante) */
export interface DespesaPendente {
  divisao_id: number;
  despesa: Despesa;
  minha_parte: number;    // valor × porcentagem/100 — calculado pelo backend
  nome_criador?: string;
}

/** Payload para criar ou editar uma despesa */
export interface EntradaDespesa {
  descricao: string;
  valor: number;
  data: string;           // "YYYY-MM-DD"
  recorrente: RecorrenciaTipo;
  comprovante_url?: string;
  situacao: SituacaoDespesa;
  divisao?: {
    email_convidado: string;
    porcentagem: number;
  };
}

/** Payload para responder uma divisão */
export interface EntradaResposta {
  resposta: 'de_acordo' | 'negado';
  justificativa?: string;
}

/** Balanço mensal com um parceiro */
export interface BalancoMensal {
  parceiro_email: string;
  parceiro_nome?: string;
  saldo: number;              // positivo = parceiro me deve; negativo = eu devo
  total_eu_lancei: number;
  total_ele_lancou: number;
}
