/**
 * receita.ts — Interfaces TypeScript para o módulo de receitas.
 *
 * Espelham os schemas Pydantic do backend (rotas/receitas.py).
 */

import { RecorrenciaTipo, ROTULOS_RECORRENCIA } from './despesa';

/** Re-exporta RecorrenciaTipo para uso no módulo de receitas */
export type { RecorrenciaTipo };
export { ROTULOS_RECORRENCIA };

/** Situação de recebimento de uma receita */
export type SituacaoReceita = 'recebido' | 'pendente';

/** Rótulos para exibição da situação */
export const ROTULOS_SITUACAO_RECEITA: Record<SituacaoReceita, string> = {
  recebido: 'Recebido',
  pendente:  'Pendente',
};

/** Dados de uma receita retornados pela API */
export interface Receita {
  id:              number;
  usuario_id:      number;
  descricao:       string;
  valor:           number;
  data:            string;       // "YYYY-MM-DD"
  recorrente:      RecorrenciaTipo;
  comprovante_url?: string;
  situacao:        SituacaoReceita;
  criado_em:       string;
}

/** Payload para criar ou editar uma receita */
export interface EntradaReceita {
  descricao:       string;
  valor:           number;
  data:            string;
  recorrente:      RecorrenciaTipo;
  comprovante_url?: string;
  situacao:        SituacaoReceita;
}

/** Resumo financeiro do mês retornado por GET /api/receitas/resumo */
export interface ResumoReceitas {
  total:      number;
  recebido:   number;
  pendente:   number;
  quantidade: number;
}
