/**
 * autenticacao.service.ts — Serviço de autenticação do elo.
 *
 * Responsabilidades:
 *   - Comunicar com os endpoints /api/auth/* do backend
 *   - Armazenar o token JWT no localStorage
 *   - Expor o usuário autenticado como Signal reativo
 *   - Verificar sessão existente ao iniciar o app
 *
 * Uso em componentes:
 *   private auth = inject(AutenticacaoService);
 *   auth.entrar({ email, senha }).subscribe(...)
 *   auth.usuarioAtual()  // Signal com o Usuario ou null
 */

import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Router } from '@angular/router';
import { tap, catchError, throwError } from 'rxjs';

import {
  Usuario,
  RespostaToken,
  EntradaLogin,
  EntradaCadastro,
} from '../modelos/usuario';

/** Chave usada para persistir o token no localStorage */
const CHAVE_TOKEN = 'elo_token';

@Injectable({
  providedIn: 'root', // disponível em toda a aplicação sem necessidade de declarar em módulo
})
export class AutenticacaoService {

  // ─── Dependências ──────────────────────────────────────────────────────────

  private http   = inject(HttpClient);
  private router = inject(Router);

  // ─── Estado reativo ────────────────────────────────────────────────────────

  /**
   * Signal com o usuário autenticado (ou null se não há sessão).
   * Componentes assinam este signal para reagir a mudanças de autenticação.
   */
  readonly usuarioAtual = signal<Usuario | null>(null);

  /**
   * Computed derivado — true se há um usuário autenticado.
   * Útil para guards de rota e diretivas condicionais.
   */
  readonly estaAutenticado = signal<boolean>(false);

  // ─── Inicialização ─────────────────────────────────────────────────────────

  constructor() {
    // Ao instanciar o serviço, verifica se há um token salvo e valida com a API
    this.inicializarSessao();
  }

  /**
   * Verifica se há um token salvo no localStorage e, se houver,
   * busca o perfil do usuário na API para confirmar que ainda é válido.
   * Chamado automaticamente no construtor.
   */
  private inicializarSessao(): void {
    const token = this.obterToken();
    if (!token) return;

    // Busca o perfil — se o token expirou a API retorna 401 e o catch limpa a sessão
    this.http
      .get<Usuario>('/api/auth/eu', { headers: this.cabecalhoAutorizacao(token) })
      .subscribe({
        next: (usuario) => {
          this.definirSessao(usuario);
        },
        error: () => {
          // Token inválido ou expirado — limpa o localStorage silenciosamente
          this.limparToken();
        },
      });
  }

  // ─── Métodos públicos ──────────────────────────────────────────────────────

  /**
   * Autentica o usuário com e-mail e senha.
   * Em caso de sucesso salva o token e atualiza o signal do usuário.
   *
   * @param dados  — { email, senha }
   * @returns Observable<RespostaToken>
   */
  entrar(dados: EntradaLogin) {
    return this.http.post<RespostaToken>('/api/auth/entrar', dados).pipe(
      tap((resposta) => {
        this.salvarToken(resposta.token_acesso);
        this.definirSessao(resposta.usuario);
      }),
      catchError((erro) => {
        const mensagem =
          erro.error?.detail ?? 'Erro ao tentar entrar. Tente novamente.';
        return throwError(() => new Error(mensagem));
      })
    );
  }

  /**
   * Cria uma nova conta e autentica automaticamente.
   *
   * @param dados  — { nome, email, senha }
   * @returns Observable<RespostaToken>
   */
  cadastrar(dados: EntradaCadastro) {
    return this.http.post<RespostaToken>('/api/auth/cadastrar', dados).pipe(
      tap((resposta) => {
        this.salvarToken(resposta.token_acesso);
        this.definirSessao(resposta.usuario);
      }),
      catchError((erro) => {
        const mensagem =
          erro.error?.detail ?? 'Erro ao criar conta. Tente novamente.';
        return throwError(() => new Error(mensagem));
      })
    );
  }

  /**
   * Encerra a sessão: remove o token e redireciona para o login.
   */
  sair(): void {
    this.limparToken();
    this.usuarioAtual.set(null);
    this.estaAutenticado.set(false);
    this.router.navigate(['/login']);
  }

  /**
   * Retorna o token JWT armazenado, ou null se não existir.
   */
  obterToken(): string | null {
    try {
      return localStorage.getItem(CHAVE_TOKEN);
    } catch {
      // localStorage pode lançar em modo privado ou com cookies bloqueados
      return null;
    }
  }

  // ─── Métodos privados ──────────────────────────────────────────────────────

  /** Persiste o token no localStorage */
  private salvarToken(token: string): void {
    try {
      localStorage.setItem(CHAVE_TOKEN, token);
    } catch {
      // Falha silenciosa — a sessão funciona sem persistência
    }
  }

  /** Remove o token do localStorage */
  private limparToken(): void {
    try {
      localStorage.removeItem(CHAVE_TOKEN);
    } catch {
      // Silencioso
    }
  }

  /** Atualiza os signals com o usuário autenticado */
  private definirSessao(usuario: Usuario): void {
    this.usuarioAtual.set(usuario);
    this.estaAutenticado.set(true);
  }

  /** Monta o header Authorization: Bearer <token> */
  private cabecalhoAutorizacao(token: string): HttpHeaders {
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }
}
