/**
 * usuario.ts — Interfaces de dados de autenticação.
 *
 * Espelha os schemas Pydantic definidos no backend (rotas/autenticacao.py).
 * Manter sincronizado com as respostas da API.
 */

/** Dados públicos do usuário autenticado */
export interface Usuario {
  id: number;
  nome: string;
  email: string;
}

/** Resposta do backend ao cadastrar ou entrar */
export interface RespostaToken {
  token_acesso: string;
  tipo_token: string;
  usuario: Usuario;
}

/** Payload enviado ao endpoint /api/auth/entrar */
export interface EntradaLogin {
  email: string;
  senha: string;
}

/** Payload enviado ao endpoint /api/auth/cadastrar */
export interface EntradaCadastro {
  nome: string;
  email: string;
  senha: string;
}
