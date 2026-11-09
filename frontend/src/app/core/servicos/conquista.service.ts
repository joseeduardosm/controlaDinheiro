/**
 * conquista.service.ts — Serviço de comunicação com os endpoints de conquistas.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

import { AutenticacaoService } from './autenticacao.service';
import { Conquista, EntradaConquista, EntradaAporte } from '../modelos/conquista';

@Injectable({ providedIn: 'root' })
export class ConquistaService {

  private http = inject(HttpClient);
  private auth = inject(AutenticacaoService);

  private cabecalho(): HttpHeaders {
    const token = this.auth.obterToken() ?? '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  private erroHttp(erro: any) {
    const mensagem = erro.error?.detail ?? 'Erro ao comunicar com a API';
    return throwError(() => new Error(mensagem));
  }

  // ─── Conquistas ───────────────────────────────────────────────────────────

  /** Lista conquistas ativas (com aportes incluídos) */
  listar(apenasAtivas = true) {
    const params = `?apenas_ativas=${apenasAtivas}`;
    return this.http
      .get<Conquista[]>(`/api/conquistas${params}`, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Cria uma nova conquista */
  criar(dados: EntradaConquista) {
    return this.http
      .post<Conquista>('/api/conquistas', dados, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Edita uma conquista */
  editar(id: number, dados: EntradaConquista) {
    return this.http
      .put<Conquista>(`/api/conquistas/${id}`, dados, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Arquiva uma conquista (mantém histórico) */
  arquivar(id: number) {
    return this.http
      .patch<Conquista>(`/api/conquistas/${id}/arquivar`, {}, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Remove permanentemente uma conquista */
  remover(id: number) {
    return this.http
      .delete<void>(`/api/conquistas/${id}`, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  // ─── Aportes ──────────────────────────────────────────────────────────────

  /** Registra um aporte — retorna a conquista atualizada */
  registrarAporte(conquistaId: number, dados: EntradaAporte) {
    return this.http
      .post<Conquista>(`/api/conquistas/${conquistaId}/aportes`, dados, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }

  /** Remove um aporte */
  removerAporte(conquistaId: number, aporteId: number) {
    return this.http
      .delete<void>(`/api/conquistas/${conquistaId}/aportes/${aporteId}`, { headers: this.cabecalho() })
      .pipe(catchError(e => this.erroHttp(e)));
  }
}
