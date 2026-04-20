import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ScrollingModule } from '@angular/cdk/scrolling';
import { CommandCenterStore } from '../data/command-center.store';
import { Severity, Tier } from '../data/command-center.models';

interface ChartDataset {
  data: number[];
  label?: string;
  borderColor?: string;
  backgroundColor?: string[];
  tension?: number;
  fill?: boolean;
}

interface ChartState {
  labels: string[];
  datasets: ChartDataset[];
}

interface ChartInstance {
  data: ChartState;
  update: () => void;
  destroy: () => void;
}

declare const Chart: {
  new (context: CanvasRenderingContext2D, config: { type: 'line' | 'doughnut'; data: ChartState }): ChartInstance;
};

@Component({
  selector: 'app-dashboard-tab',
  templateUrl: './dashboard-tab.component.html',
  styleUrl: './dashboard-tab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  standalone: true,
  imports: [CommonModule, ScrollingModule]
})
export class DashboardTabComponent implements AfterViewInit, OnDestroy {
  private readonly store = inject(CommandCenterStore);
  private toastTimeoutId?: number;
  private timerTickId?: number;

  @ViewChild('volumeCanvas')
  private volumeCanvas?: ElementRef<HTMLCanvasElement>;

  @ViewChild('platformCanvas')
  private platformCanvas?: ElementRef<HTMLCanvasElement>;

  private volumeChart?: ChartInstance;
  private pieChart?: ChartInstance;
  readonly activeIncidentSearch = signal('');
  readonly platformFilter = signal('All');
  readonly severityFilter = signal('All');
  readonly tierFilter = signal('All');
  readonly statusFilter = signal<'All' | 'Active' | 'Being Resolved'>('All');
  readonly pendingResolutionId = signal<string | null>(null);
  readonly resolutionSolution = signal('');
  readonly expandedIncidentId = signal<string | null>(null);
  readonly resolutionToast = signal('');
  readonly platformOptions = ['Databricks', 'Dynatrace', 'Kafka', 'Airflow', 'dbt'];
  readonly severityOptions: Severity[] = ['P1', 'P2', 'P3', 'P4'];
  readonly tierOptions: Tier[] = ['L1', 'L2', 'L3'];
  readonly statusOptions: Array<'Active' | 'Being Resolved'> = ['Active', 'Being Resolved'];

  // Pagination and filtering
  readonly currentPage = this.store.currentPage;
  readonly totalPages = this.store.totalPages;
  readonly pageSize = this.store.pageSize;
  readonly isLoadingPage = this.store.isLoadingPage;

  // Auto-trigger page load when filters change
  private readonly filterSync = effect(() => {
    const search = this.activeIncidentSearch();
    const platform = this.platformFilter();
    const severity = this.severityFilter();
    const tier = this.tierFilter();
    const status = this.statusFilter();

    // Reset to page 1 when filters change
    this.store.loadIncidentsPage(1, {
      search: search.trim() || undefined,
      platform: platform !== 'All' ? platform : undefined,
      severity: severity !== 'All' ? severity : undefined,
      tier: tier !== 'All' ? tier : undefined,
      status: status !== 'All' ? status : undefined
    });
  });

  // Display current page incidents with local search scoring
  readonly filteredIncidents = computed(() => {
    const query = this.activeIncidentSearch().trim().toLowerCase();
    const items = this.store.incidents();

    if (!query) {
      return items;
    }

    // Already filtered by store, just apply scoring for ranking
    const tokens = query.split(/\s+/).filter(Boolean);
    return items
      .map((incident) => ({ incident, score: this.scoreIncident(incident, tokens) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .map(({ incident }) => incident);
  });

  private readonly chartSync = effect(() => {
    const volume = this.store.incidentVolume();
    const platform = this.store.platformBreakdown();
    this.syncCharts(volume.labels, volume.values, platform.labels, platform.values);
  });

  readonly incidents = this.store.incidents;
  readonly openCount = this.store.openIncidentCount;
  readonly mttr = this.store.mttr;
  readonly resolved7d = this.store.resolved7d;
  readonly platformSummary = this.store.platformSummary;
  readonly todaysOnCallSummary = this.store.todaysOnCallSummary;
  readonly monthlySla = this.store.monthlySlaCompliance;
  readonly rolling48hSla = this.store.latestRolling48hSnapshot;
  readonly slaTargets = this.store.slaTargets;
  readonly nowMs = signal(Date.now());

  readonly slaMtd = this.store.monthlySlaCompliancePercent;

  clearIncidentFilters(): void {
    this.activeIncidentSearch.set('');
    this.platformFilter.set('All');
    this.severityFilter.set('All');
    this.tierFilter.set('All');
    this.statusFilter.set('All');
    // filterSync effect will automatically trigger reload to page 1
  }

  hasActiveIncidentFilters(): boolean {
    return [this.platformFilter(), this.severityFilter(), this.tierFilter(), this.statusFilter()].some((value) => value !== 'All') || this.activeIncidentSearch().length > 0;
  }

  goToPage(page: number): void {
    this.store.loadIncidentsPage(page, {
      search: this.activeIncidentSearch().trim() || undefined,
      platform: this.platformFilter() !== 'All' ? this.platformFilter() : undefined,
      severity: this.severityFilter() !== 'All' ? this.severityFilter() : undefined,
      tier: this.tierFilter() !== 'All' ? this.tierFilter() : undefined,
      status: this.statusFilter() !== 'All' ? this.statusFilter() : undefined
    });
  }

  nextPage(): void {
    this.store.nextPage({
      search: this.activeIncidentSearch().trim() || undefined,
      platform: this.platformFilter() !== 'All' ? this.platformFilter() : undefined,
      severity: this.severityFilter() !== 'All' ? this.severityFilter() : undefined,
      tier: this.tierFilter() !== 'All' ? this.tierFilter() : undefined,
      status: this.statusFilter() !== 'All' ? this.statusFilter() : undefined
    });
  }

  previousPage(): void {
    this.store.previousPage({
      search: this.activeIncidentSearch().trim() || undefined,
      platform: this.platformFilter() !== 'All' ? this.platformFilter() : undefined,
      severity: this.severityFilter() !== 'All' ? this.severityFilter() : undefined,
      tier: this.tierFilter() !== 'All' ? this.tierFilter() : undefined,
      status: this.statusFilter() !== 'All' ? this.statusFilter() : undefined
    });
  }

  async acknowledgeIncident(id: string): Promise<void> {
    const acknowledged = await this.store.acknowledgeIncident(id);
    if (!acknowledged) {
      this.showToast(`Could not acknowledge incident ${id}. Please try again.`);
      return;
    }

    this.showToast(`Incident ${id} acknowledged and moved to Being Resolved.`);
  }

  resolveIncident(id: string): void {
    if (!this.canResolveIncident(id)) {
      this.showToast(`Please acknowledge incident ${id} before resolving.`);
      return;
    }

    this.pendingResolutionId.set(id);
    this.resolutionSolution.set('');
  }

  canResolveIncident(id: string): boolean {
    return this.store.allIncidents().some((incident) => incident.id === id && incident.status === 'Being Resolved');
  }

  cancelResolution(): void {
    this.pendingResolutionId.set(null);
    this.resolutionSolution.set('');
  }

  toggleIncidentDetails(id: string): void {
    this.expandedIncidentId.update((current) => (current === id ? null : id));
  }

  isIncidentExpanded(id: string): boolean {
    return this.expandedIncidentId() === id;
  }

  async submitResolution(): Promise<void> {
    const incidentId = this.pendingResolutionId();
    if (!incidentId) {
      return;
    }

    const solution = this.resolutionSolution().trim();
    if (!solution) {
      return;
    }

    const resolved = await this.store.resolveIncident(incidentId, solution);
    this.cancelResolution();

    if (resolved) {
      this.showToast(`Incident ${incidentId} resolved successfully.`);
      return;
    }

    this.showToast(`Could not resolve incident ${incidentId}. Please try again.`);
  }

  ngAfterViewInit(): void {
    this.initializeCharts();
    const volume = this.store.incidentVolume();
    const platform = this.store.platformBreakdown();
    this.syncCharts(volume.labels, volume.values, platform.labels, platform.values);

    this.timerTickId = window.setInterval(() => {
      this.nowMs.set(Date.now());
    }, 1000);
  }

  ngOnDestroy(): void {
    this.volumeChart?.destroy();
    this.pieChart?.destroy();
    if (this.toastTimeoutId) {
      window.clearTimeout(this.toastTimeoutId);
    }
    if (this.timerTickId) {
      window.clearInterval(this.timerTickId);
    }
  }

  resolutionTimerLabel(incidentId: string): string {
    const incident = this.store.allIncidents().find((item) => item.id === incidentId);
    if (!incident) {
      return '--:--:--';
    }

    const target = this.store.slaTargets().find(
      (item) => item.severity === incident.severity && item.tier === incident.tier
    );
    if (!target) {
      return '--:--:--';
    }

    const targetMs = target.resolutionMins * 60 * 1000;
    const elapsedMs = Math.max(0, this.nowMs() - incident.openedAt);
    const remainingMs = targetMs - elapsedMs;
    const absMs = Math.abs(remainingMs);
    const hours = Math.floor(absMs / 3600000);
    const minutes = Math.floor((absMs % 3600000) / 60000);
    const seconds = Math.floor((absMs % 60000) / 1000);
    const sign = remainingMs < 0 ? '-' : '';

    return `${sign}${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  resolutionTimerClass(incidentId: string): 'sla-timer sla-timer-ok' | 'sla-timer sla-timer-alert' {
    const incident = this.store.allIncidents().find((item) => item.id === incidentId);
    if (!incident) {
      return 'sla-timer sla-timer-alert';
    }

    const target = this.store.slaTargets().find(
      (item) => item.severity === incident.severity && item.tier === incident.tier
    );
    if (!target) {
      return 'sla-timer sla-timer-alert';
    }

    const targetMs = target.resolutionMins * 60 * 1000;
    const elapsedMs = Math.max(0, this.nowMs() - incident.openedAt);
    const halfTimeMs = targetMs / 2;

    if (elapsedMs < halfTimeMs) {
      return 'sla-timer sla-timer-ok';
    }

    return 'sla-timer sla-timer-alert';
  }

  private showToast(message: string): void {
    this.resolutionToast.set(message);

    if (this.toastTimeoutId) {
      window.clearTimeout(this.toastTimeoutId);
    }

    this.toastTimeoutId = window.setTimeout(() => {
      this.resolutionToast.set('');
    }, 3000);
  }

  private initializeCharts(): void {
    const volumeContext = this.volumeCanvas?.nativeElement.getContext('2d');
    const pieContext = this.platformCanvas?.nativeElement.getContext('2d');

    if (!volumeContext || !pieContext || typeof Chart === 'undefined') {
      return;
    }

    this.volumeChart = new Chart(volumeContext, {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          {
            label: 'Incidents',
            data: [],
            borderColor: '#1e4a6b',
            tension: 0.2,
            fill: false
          }
        ]
      }
    });

    this.pieChart = new Chart(pieContext, {
      type: 'doughnut',
      data: {
        labels: [],
        datasets: [
          {
            data: [],
            backgroundColor: ['#2c7da0', '#61a5c2', '#a9d6e5']
          }
        ]
      }
    });
  }

  private syncCharts(
    volumeLabels: string[],
    volumeValues: number[],
    platformLabels: string[],
    platformValues: number[]
  ): void {
    if (this.volumeChart) {
      this.volumeChart.data.labels = volumeLabels;
      this.volumeChart.data.datasets[0].data = volumeValues;
      this.volumeChart.update();
    }

    if (this.pieChart) {
      this.pieChart.data.labels = platformLabels;
      this.pieChart.data.datasets[0].data = platformValues;
      this.pieChart.update();
    }
  }

  private scoreIncident(
    incident: {
      id: string;
      platform: string;
      severity: string;
      tier: string;
      error: string;
      tags: string[];
    },
    tokens: string[]
  ): number {
    const fields = [incident.id, incident.platform, incident.severity, incident.tier, incident.error].join(' ').toLowerCase();

    let score = 0;

    for (const token of tokens) {
      if (incident.tags.some((tag) => tag.toLowerCase().includes(token))) {
        score += 6;
      }

      if (incident.error.toLowerCase().includes(token)) {
        score += 3;
      }

      if (fields.includes(token)) {
        score += 1;
      }
    }

    return score;
  }
}
