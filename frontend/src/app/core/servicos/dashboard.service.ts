/**
 * dashboard.service.ts — Serviço do dashboard principal.
 *
 * Busca o resumo agregado (receitas + despesas + balanço do casal)
 * e os lançamentos recentes do mês em duas chamadas paralelas.
 */

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { forkJoin, catchError, of } from 'rxjs';

import { AutenticacaoService } from './autenticacao.service';
import { Despesa } from '../modelos/despesa';
import { Receita } from '../modelos/receita';

// ─── Interfaces do resumo do dashboard ───────────────────────────────────────

export interface ResumoReceitas {
  total: number; recebido: number; pendente: number; quantidade: number;
}

export interface ResumoDespesas {
  total: number; pago: number; pendente: number;
  quantidade: number; compartilhadas: number;
}

export interface BalancoParceiro {
  parceiro_email: string;
  parceiro_nome?: string;
  saldo: number;
}

export interface ResumoDashboard {
  mes: number; ano: number;
  receitas: ResumoReceitas;
  despesas: ResumoDespesas;
  saldo: number;
  balanco_casal: BalancoParceiro[];
}

/** Lançamento unificado (despesa ou receita) para a lista recente */
export interface LancamentoRecente {
  descricao: string;
  valor: number;       // positivo = receita, negativo = despesa
  data: string;        // YYYY-MM-DD
  tipo: 'receita' | 'despesa';
  situacao: string;
}

/** Dados completos do dashboard */
export interface DadosDashboard {
  resumo: ResumoDashboard;
  lancamentos: LancamentoRecente[];
}

@Injectable({ providedIn: 'root' })
export class DashboardService {

  private http = inject(HttpClient);
  private auth = inject(AutenticacaoService);

  private cabecalho(): HttpHeaders {
    const token = this.auth.obterToken() ?? '';
    return new HttpHeaders({ Authorization: `Bearer ${token}` });
  }

  /**
   * Busca resumo e lançamentos em paralelo.
   * Nunca falha — erros individuais retornam valores neutros.
   */
  carregarDashboard(mes: number, ano: number) {
    const params = new HttpParams().set('mes', mes).set('ano', ano);
    const h = this.cabecalho();

    return forkJoin({
      resumo: this.http
        .get<ResumoDashboard>('/api/dashboard/resumo', { headers: h, params })
        .pipe(catchError(() => of(this._resumoVazio(mes, ano)))),

      despesas: this.http
        .get<Despesa[]>('/api/despesas', { headers: h, params })
        .pipe(catchError(() => of([] as Despesa[]))),

      receitas: this.http
        .get<Receita[]>('/api/receitas', { headers: h, params })
        .pipe(catchError(() => of([] as Receita[]))),
    });
  }

  /** Mescla despesas e receitas, ordena por data e retorna os 8 mais recentes */
  compilarLancamentos(despesas: Despesa[], receitas: Receita[]): LancamentoRecente[] {
    const lista: LancamentoRecente[] = [
      ...despesas.filter(d => !d.divisao).map(d => ({
        descricao: d.descricao,
        valor:     -d.valor,          // negativo = saída
        data:      d.data,
        tipo:      'despesa' as const,
        situacao:  d.situacao,
      })),
      ...receitas.map(r => ({
        descricao: r.descricao,
        valor:     r.valor,           // positivo = entrada
        data:      r.data,
        tipo:      'receita' as const,
        situacao:  r.situacao,
      })),
    ];

    return lista
      .sort((a, b) => b.data.localeCompare(a.data))
      .slice(0, 8);
  }

  private _resumoVazio(mes: number, ano: number): ResumoDashboard {
    return {
      mes, ano,
      receitas: { total: 0, recebido: 0, pendente: 0, quantidade: 0 },
      despesas: { total: 0, pago: 0, pendente: 0, quantidade: 0, compartilhadas: 0 },
      saldo: 0,
      balanco_casal: [],
    };
  }
}
