/**
 * receita.service.ts — Serviço de comunicação com os endpoints de receitas.
 *
 * Padrão do projeto: inject(HttpClient) + cabeçalho JWT manual.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

import { AutenticacaoService } from './autenticacao.service';
import { Receita, EntradaReceita, ResumoReceitas, SituacaoReceita } from '../modelos/receita';

@Injectable({ providedIn: 'root' })
export class ReceitaService {

  private http = inject(HttpClient);
  private auth = inject(AutenticacaoService);

  // ─── Helper: cabeçalho com JWT ────────────────────────────────────────────

  private cabecalho(): HttpHeaders {
    const token = this.auth.obterToken() ?? '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private erroHttp(erro: any) {
    const mensagem = erro.error?.detail ?? 'Erro ao comunicar com a API';
    return throwError(() => new Error(mensagem));
  }

  // ─── CRUD ─────────────────────────────────────────────────────────────────

  /** Lista receitas do mês com filtros opcionais */
  listar(params?: { mes?: number; ano?: number; situacao?: SituacaoReceita }) {
    let p = new HttpParams();
    if (params?.mes)      p = p.set('mes', params.mes);
    if (params?.ano)      p = p.set('ano', params.ano);
    if (params?.situacao) p = p.set('situacao', params.situacao);

    return this.http
      .get<Receita[]>('/api/receitas', { headers: this.cabecalho(), params: p })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Resumo financeiro do mês (total, recebido, pendente) */
  resumo(mes: number, ano: number) {
    const p = new HttpParams().set('mes', mes).set('ano', ano);
    return this.http
      .get<ResumoReceitas>('/api/receitas/resumo', { headers: this.cabecalho(), params: p })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Cria uma nova receita */
  criar(dados: EntradaReceita) {
    return this.http
      .post<Receita>('/api/receitas', dados, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Edita uma receita existente */
  editar(id: number, dados: EntradaReceita) {
    return this.http
      .put<Receita>(`/api/receitas/${id}`, dados, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Remove uma receita */
  remover(id: number) {
    return this.http
      .delete<void>(`/api/receitas/${id}`, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }
}
