import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    redirectTo: 'login',
    pathMatch: 'full',
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./features/auth/login/login.component').then(m => m.LoginComponent),
  },
  {
    // Shell envolve todas as páginas autenticadas com a topbar
    path: '',
    loadComponent: () =>
      import('./features/layout/shell.component').then(m => m.ShellComponent),
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./features/dashboard/dashboard-home.component').then(m => m.DashboardHomeComponent),
      },
      {
        path: 'despesas',
        loadComponent: () =>
          import('./features/despesas/despesas.component').then(m => m.DespesasComponent),
      },
      {
        path: 'receitas',
        loadComponent: () =>
          import('./features/receitas/receitas.component').then(m => m.ReceitasComponent),
      },
      {
        path: 'casal',
        loadComponent: () =>
          import('./features/casal/casal.component').then(m => m.CasalComponent),
      },
      {
        path: 'conquistas',
        loadComponent: () =>
          import('./features/conquistas/conquistas.component').then(m => m.ConquistasComponent),
      },
      {
        path: 'cartoes',
        loadComponent: () =>
          import('./features/cartoes/cartoes.component').then(m => m.CartoesComponent),
      },
      // Futuras rotas autenticadas:
      // { path: 'cartoes',    loadComponent: () => import(...) },
      // { path: 'relatorios', loadComponent: () => import(...) },
    ],
  },
];
