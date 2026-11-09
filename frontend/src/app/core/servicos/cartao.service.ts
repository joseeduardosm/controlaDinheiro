/**
 * cartao.service.ts — Comunicação com os endpoints de cartões e lançamentos.
 */

import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, tap, throwError } from 'rxjs';

import { AutenticacaoService } from './autenticacao.service';
import {
  Cartao, EntradaCartao, LancamentoFatura, EntradaLancamento,
  ResumoFatura, CartaoLancamentoPendente,
} from '../modelos/cartao';

@Injectable({ providedIn: 'root' })
export class CartaoService {

  private http = inject(HttpClient);
  private auth = inject(AutenticacaoService);

  /**
   * Lista de lançamentos de cartões aguardando aprovação do usuário.
   * Alimentado por carregarPendentes() e consumido pelo ModalAprovacao.
   */
  pendentes = signal<CartaoLancamentoPendente[]>([]);

  private cabecalho(): HttpHeaders {
    const token = this.auth.obterToken() ?? '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private erroHttp(erro: any) {
    const mensagem = erro.error?.detail ?? 'Erro ao comunicar com a API';
    return throwError(() => new Error(mensagem));
  }

  // ─── Cartões ───────────────────────────────────────────────────────────────

  /** Lista cartões ativos do usuário. */
  listar() {
    return this.http
      .get<Cartao[]>('/api/cartoes/', { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Cria um novo cartão. */
  criar(dados: EntradaCartao) {
    return this.http
      .post<Cartao>('/api/cartoes/', dados, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Edita um cartão existente. */
  editar(id: number, dados: EntradaCartao) {
    return this.http
      .put<Cartao>(`/api/cartoes/${id}`, dados, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Remove um cartão e todos os seus lançamentos. */
  remover(id: number) {
    return this.http
      .delete<void>(`/api/cartoes/${id}`, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  // ─── Fatura ────────────────────────────────────────────────────────────────

  /** Lista lançamentos de um cartão cujas parcelas vencem no mês/ano. */
  listarFatura(cartaoId: number, mes: number, ano: number) {
    return this.http
      .get<LancamentoFatura[]>(
        `/api/cartoes/${cartaoId}/fatura?mes=${mes}&ano=${ano}`,
        { headers: this.cabecalho() }
      )
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Totais da fatura (total, pago, pendente) de um mês. */
  resumoFatura(cartaoId: number, mes: number, ano: number) {
    return this.http
      .get<ResumoFatura>(
        `/api/cartoes/${cartaoId}/fatura-resumo?mes=${mes}&ano=${ano}`,
        { headers: this.cabecalho() }
      )
      .pipe(catchError(e => this.erroHttp(e)));
  }

  // ─── Lançamentos ──────────────────────────────────────────────────────────

  /** Registra um lançamento no cartão. */
  criarLancamento(cartaoId: number, dados: EntradaLancamento) {
    return this.http
      .post<LancamentoFatura>(
        `/api/cartoes/${cartaoId}/lancamentos`, dados, { headers: this.cabecalho() }
      )
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Edita um lançamento existente. */
  editarLancamento(lancamentoId: number, dados: EntradaLancamento) {
    return this.http
      .put<LancamentoFatura>(
        `/api/cartoes/lancamentos/${lancamentoId}`, dados, { headers: this.cabecalho() }
      )
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Alterna situação de um lançamento (pago ↔ pendente). */
  alterarSituacao(lancamentoId: number, situacao: 'pago' | 'pendente') {
    return this.http
      .patch<LancamentoFatura>(
        `/api/cartoes/lancamentos/${lancamentoId}/situacao`,
        { situacao },
        { headers: this.cabecalho() }
      )
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Remove um lançamento. */
  removerLancamento(lancamentoId: number) {
    return this.http
      .delete<void>(
        `/api/cartoes/lancamentos/${lancamentoId}`,
        { headers: this.cabecalho() }
      )
      .pipe(catchError(e => this.erroHttp(e)));
  }

  // ─── Divisão / Pendentes ───────────────────────────────────────────────────

  /**
   * Busca lançamentos de outros usuários aguardando aprovação.
   * Armazena no signal `pendentes` para o ModalAprovacao consumir.
   */
  carregarPendentes() {
    return this.http
      .get<CartaoLancamentoPendente[]>(
        '/api/cartoes/lancamentos/pendentes',
        { headers: this.cabecalho() }
      )
      .pipe(
        tap(lista => this.pendentes.set(lista)),
        catchError(e => this.erroHttp(e)),
      );
  }

  /**
   * Aceita ou nega a divisão de um lançamento.
   * Remove o item do signal `pendentes` após resposta.
   */
  responder(lancamentoId: number, dados: { resposta: string; justificativa?: string }) {
    return this.http
      .post<{ status: string }>(
        `/api/cartoes/lancamentos/${lancamentoId}/responder`,
        dados,
        { headers: this.cabecalho() }
      )
      .pipe(
        tap(() => {
          // Remove o item respondido da lista de pendentes
          this.pendentes.update(lista =>
            lista.filter(p => p.lancamento_id !== lancamentoId)
          );
        }),
        catchError(e => this.erroHttp(e)),
      );
  }
}
