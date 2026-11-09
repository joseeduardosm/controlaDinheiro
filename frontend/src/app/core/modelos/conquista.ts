/**
 * conquista.ts — Interfaces TypeScript para o módulo de conquistas (metas de poupança).
 */

/** Aporte feito em direção a uma conquista */
export interface Aporte {
  id:           number;
  conquista_id: number;
  valor:        number;
  data:         string;    // "YYYY-MM-DD"
  descricao?:   string;
  criado_em:    string;
}

/** Conquista (meta de poupança) com aportes e acumulado calculado */
export interface Conquista {
  id:         number;
  usuario_id: number;
  nome:       string;
  descricao?: string;
  meta:       number;
  acumulado:  number;    // soma dos aportes — calculado no backend
  prazo:      string;    // "YYYY-MM-DD"
  emoji?:     string;
  ativo:      boolean;
  criado_em:  string;
  aportes:    Aporte[];
}

/** Payload para criar ou editar uma conquista */
export interface EntradaConquista {
  nome:      string;
  descricao?: string;
  meta:      number;
  prazo:     string;
  emoji?:    string;
}

/** Payload para registrar um aporte */
export interface EntradaAporte {
  valor:      number;
  data:       string;
  descricao?: string;
}
