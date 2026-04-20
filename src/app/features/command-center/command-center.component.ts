import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DashboardTabComponent } from './tabs/dashboard-tab.component';
import { IncidentsTabComponent } from './tabs/incidents-tab.component';
import { RosterTabComponent } from './tabs/roster-tab.component';
import { LearningTabComponent } from './tabs/learning-tab.component';
import { RunbooksTabComponent } from './tabs/runbooks-tab.component';
import { CoverageTabComponent } from './tabs/coverage-tab.component';
import { ToolsTabComponent } from './tabs/tools-tab.component';
import { SlasTabComponent } from './tabs/slas-tab.component';
import { CommandCenterStore } from './data/command-center.store';

type TabId = 'dashboard' | 'incidents' | 'roster' | 'learning' | 'runbooks' | 'coverage' | 'tools' | 'slas';

interface TabItem {
  id: TabId;
  icon: string;
  label: string;
}

@Component({
  selector: 'app-command-center',
  imports: [
    DashboardTabComponent,
    IncidentsTabComponent,
    RosterTabComponent,
    LearningTabComponent,
    RunbooksTabComponent,
    CoverageTabComponent,
    ToolsTabComponent,
    SlasTabComponent
  ],
  templateUrl: './command-center.component.html',
  styleUrl: './command-center.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CommandCenterComponent {
  readonly tabs: TabItem[] = [
    { id: 'dashboard', icon: 'fa-tachometer-alt', label: 'Dashboard' },
    { id: 'incidents', icon: 'fa-exclamation-triangle', label: 'Incidents' },
    { id: 'roster', icon: 'fa-users', label: 'Roster' },
    { id: 'learning', icon: 'fa-graduation-cap', label: 'Learning Path' },
    { id: 'runbooks', icon: 'fa-book', label: 'Runbooks' },
    { id: 'coverage', icon: 'fa-th', label: 'Coverage Matrix' },
    { id: 'tools', icon: 'fa-toolbox', label: 'Tools' },
    { id: 'slas', icon: 'fa-chart-line', label: 'SLAs' }
  ];

  readonly activeTab = signal<TabId>('dashboard');
  readonly store = inject(CommandCenterStore);

  setTab(tabId: TabId): void {
    this.activeTab.set(tabId);
  }
}
