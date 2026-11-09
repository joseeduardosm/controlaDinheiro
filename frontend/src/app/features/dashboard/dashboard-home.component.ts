/**
 * DashboardHomeComponent — Tela inicial do elo.
 *
 * Dados reais via /api/dashboard/resumo + /api/despesas + /api/receitas.
 * Exibe: saldo do mês, tiles de receita/despesa/pendências,
 * balanço do casal (se houver), lançamentos recentes e seção de conquistas.
 */

import { Component, inject, signal, computed, OnInit } from '@angular/core';
import { RouterLink } from '@angular/router';

import { AutenticacaoService } from '../../core/servicos/autenticacao.service';
import {
  DashboardService,
  ResumoDashboard,
  LancamentoRecente,
  BalancoParceiro,
} from '../../core/servicos/dashboard.service';

@Component({
  selector: 'app-dashboard-home',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './dashboard-home.component.html',
  styleUrl: './dashboard-home.component.scss',
})
export class DashboardHomeComponent implements OnInit {

  protected auth             = inject(AutenticacaoService);
  private dashboardServico   = inject(DashboardService);

  // ─── Período ──────────────────────────────────────────────────────────────

  mesAtual  = signal(new Date().getMonth() + 1);
  anoAtual  = signal(new Date().getFullYear());

  // ─── Estado ───────────────────────────────────────────────────────────────

  carregando   = signal(true);
  resumo       = signal<ResumoDashboard | null>(null);
  lancamentos  = signal<LancamentoRecente[]>([]);

  // ─── Computed ─────────────────────────────────────────────────────────────

  rotuloPeriodo = computed(() => {
    const nomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho',
                   'Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
    return `${nomes[this.mesAtual() - 1]} ${this.anoAtual()}`;
  });

  /** true = saldo positivo (receitas > despesas) */
  saldoPositivo = computed(() => (this.resumo()?.saldo ?? 0) >= 0);

  // ─── Ciclo de vida ────────────────────────────────────────────────────────

  ngOnInit() {
    this._carregar();
  }

  // ─── Navegação de mês ─────────────────────────────────────────────────────

  mesAnterior() {
    if (this.mesAtual() === 1) { this.mesAtual.set(12); this.anoAtual.update(a => a - 1); }
    else { this.mesAtual.update(m => m - 1); }
    this._carregar();
  }

  proximoMes() {
    if (this.mesAtual() === 12) { this.mesAtual.set(1); this.anoAtual.update(a => a + 1); }
    else { this.mesAtual.update(m => m + 1); }
    this._carregar();
  }

  // ─── Helpers de template ──────────────────────────────────────────────────

  protected get primeiroNome(): string {
    return this.auth.usuarioAtual()?.nome?.split(' ')[0] ?? 'você';
  }

  protected moeda(v: number): string {
    return Math.abs(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  protected dataCurta(iso: string): string {
    const [, m, d] = iso.split('-');
    return `${d}/${m}`;
  }

  protected ehReceita(l: LancamentoRecente): boolean { return l.tipo === 'receita'; }

  /** Cor do card de balanço do casal */
  protected fundoBalanco(saldo: number): string {
    if (saldo > 0) return 'var(--color-periwinkle-mist)';
    if (saldo < 0) return 'rgba(255, 148, 115, 0.12)';
    return '#fff';
  }

  /** Rótulo do saldo do casal */
  protected rotuloSaldoCasal(item: BalancoParceiro): string {
    const nome = item.parceiro_nome ?? item.parceiro_email;
    if (item.saldo > 0) return `${nome} te deve`;
    if (item.saldo < 0) return `Você deve a ${nome}`;
    return `Quites com ${nome}`;
  }

  // ─── Interno ──────────────────────────────────────────────────────────────

  private _carregar() {
    this.carregando.set(true);

    this.dashboardServico
      .carregarDashboard(this.mesAtual(), this.anoAtual())
      .subscribe({
        next: ({ resumo, despesas, receitas }) => {
          this.resumo.set(resumo);
          this.lancamentos.set(
            this.dashboardServico.compilarLancamentos(despesas, receitas)
          );
          this.carregando.set(false);
        },
        error: () => this.carregando.set(false),
      });
  }
}
