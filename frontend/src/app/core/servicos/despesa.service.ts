/**
 * despesa.service.ts — Serviço de comunicação com os endpoints de despesas.
 *
 * Padrão do projeto: inject(HttpClient) + Signals reativos + Observable por chamada.
 * Todos os endpoints requerem token JWT (adicionado automaticamente pelo interceptor
 * quando implementado; por ora usa o header manual via obterToken()).
 */

import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { catchError, tap, throwError } from 'rxjs';

import { AutenticacaoService } from './autenticacao.service';
import {
  Despesa,
  DespesaPendente,
  EntradaDespesa,
  EntradaResposta,
  DespesaDivisao,
  BalancoMensal,
  SituacaoDespesa,
} from '../modelos/despesa';

@Injectable({ providedIn: 'root' })
export class DespesaService {

  private http  = inject(HttpClient);
  private auth  = inject(AutenticacaoService);

  // ─── Estado reativo ────────────────────────────────────────────────────────

  /** Lista de despesas pendentes de aprovação pelo usuário logado */
  readonly pendentes = signal<DespesaPendente[]>([]);

  /** Quantidade de pendências — exibida como badge na topbar */
  readonly quantidadePendentes = signal<number>(0);

  // ─── Helper: cabeçalho com JWT ─────────────────────────────────────────────

  private cabecalho(): HttpHeaders {
    const token = this.auth.obterToken() ?? '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private erroHttp(erro: any) {
    const mensagem = erro.error?.detail ?? 'Erro ao comunicar com a API';
    return throwError(() => new Error(mensagem));
  }

  // ─── Despesas ──────────────────────────────────────────────────────────────

  /** Lista as despesas do usuário com filtros opcionais */
  listar(params?: { mes?: number; ano?: number; situacao?: SituacaoDespesa }) {
    let httpParams = new HttpParams();
    if (params?.mes)      httpParams = httpParams.set('mes', params.mes);
    if (params?.ano)      httpParams = httpParams.set('ano', params.ano);
    if (params?.situacao) httpParams = httpParams.set('situacao', params.situacao);

    return this.http
      .get<Despesa[]>('/api/despesas', { headers: this.cabecalho(), params: httpParams })
      .pipe(catchError(this.erroHttp));
  }

  /** Cria uma nova despesa (com divisão opcional) */
  criar(dados: EntradaDespesa) {
    return this.http
      .post<Despesa>('/api/despesas', dados, { headers: this.cabecalho() })
      .pipe(catchError(this.erroHttp));
  }

  /** Edita uma despesa existente */
  editar(id: number, dados: EntradaDespesa) {
    return this.http
      .put<Despesa>(`/api/despesas/${id}`, dados, { headers: this.cabecalho() })
      .pipe(catchError(this.erroHttp));
  }

  /** Remove uma despesa */
  remover(id: number) {
    return this.http
      .delete<void>(`/api/despesas/${id}`, { headers: this.cabecalho() })
      .pipe(catchError(this.erroHttp));
  }

  // ─── Divisões / aprovação ──────────────────────────────────────────────────

  /**
   * Busca as divisões pendentes de aprovação do usuário logado.
   * Atualiza o signal `pendentes` e `quantidadePendentes`.
   */
  carregarPendentes() {
    return this.http
      .get<DespesaPendente[]>('/api/despesas/pendentes', { headers: this.cabecalho() })
      .pipe(
        tap((lista) => {
          this.pendentes.set(lista);
          this.quantidadePendentes.set(lista.length);
        }),
        catchError(this.erroHttp),
      );
  }

  /**
   * Aceita ou nega uma divisão de despesa.
   * Após responder, remove a item da lista de pendentes.
   */
  responder(divisaoId: number, dados: EntradaResposta) {
    return this.http
      .post<DespesaDivisao>(
        `/api/despesas/divisoes/${divisaoId}/responder`,
        dados,
        { headers: this.cabecalho() },
      )
      .pipe(
        tap(() => {
          // Remove a pendência respondida do signal local
          this.pendentes.update((lista) =>
            lista.filter((p) => p.divisao_id !== divisaoId)
          );
          this.quantidadePendentes.update((n) => Math.max(0, n - 1));
        }),
        catchError(this.erroHttp),
      );
  }

  // ─── Balanço mensal ────────────────────────────────────────────────────────

  /** Calcula o balanço mensal do usuário com cada parceiro */
  balanco(mes: number, ano: number) {
    const params = new HttpParams().set('mes', mes).set('ano', ano);
    return this.http
      .get<BalancoMensal[]>('/api/despesas/balanco', { headers: this.cabecalho(), params })
      .pipe(catchError(this.erroHttp));
  }
}
