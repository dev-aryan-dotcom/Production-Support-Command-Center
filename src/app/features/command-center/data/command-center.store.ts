import { Injectable, computed, inject, signal } from '@angular/core';
import { catchError, of } from 'rxjs';
import { CoverageLevel, Environment, Incident, IncidentHistory, IncidentRecord, TeamMember, Tier, Severity, SlaSnapshotRecord, SlaTargetRecord } from './command-center.models';
import { IncidentApiService } from './incident-api.service';

interface ChartSeries {
  labels: string[];
  values: number[];
}

type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

interface RosterRow {
  role: Tier;
  shifts: string[];
}

export interface IncidentHistoryViewRow {
  id: string;
  platform: string;
  severity: Severity;
  tier: Tier;
  resolvedMins: number | null;
  status: 'Active' | 'Being Resolved' | 'Resolved';
  openedAt: number;
  opened: string;
  resolvedAt: string | null;
  resolvedAtMs: number | null;
  error: string;
  solution: string;
  tags: string[];
}

@Injectable({ providedIn: 'root' })
export class CommandCenterStore {
  private static readonly FORTY_EIGHT_HOURS_MS = 48 * 60 * 60 * 1000;
  private static readonly MONTHLY_SLA_TARGET_PERCENT = 99.9;
  private static readonly PROFESSIONAL_ID_PATTERN = /^INC-(\d+)$/;
  private static readonly DEFAULT_SLA_TARGETS: SlaTargetRecord[] = [
    { id: 'P1-L1', severity: 'P1', tier: 'L1', responseMins: 15, resolutionMins: 60 },
    { id: 'P1-L2', severity: 'P1', tier: 'L2', responseMins: 10, resolutionMins: 30 },
    { id: 'P1-L3', severity: 'P1', tier: 'L3', responseMins: 5, resolutionMins: 15 },
    { id: 'P2-L1', severity: 'P2', tier: 'L1', responseMins: 30, resolutionMins: 180 },
    { id: 'P2-L2', severity: 'P2', tier: 'L2', responseMins: 20, resolutionMins: 90 },
    { id: 'P2-L3', severity: 'P2', tier: 'L3', responseMins: 15, resolutionMins: 45 },
    { id: 'P3-L1', severity: 'P3', tier: 'L1', responseMins: 60, resolutionMins: 480 },
    { id: 'P3-L2', severity: 'P3', tier: 'L2', responseMins: 45, resolutionMins: 240 },
    { id: 'P3-L3', severity: 'P3', tier: 'L3', responseMins: 30, resolutionMins: 120 },
    { id: 'P4-L1', severity: 'P4', tier: 'L1', responseMins: 120, resolutionMins: 1440 },
    { id: 'P4-L2', severity: 'P4', tier: 'L2', responseMins: 90, resolutionMins: 720 },
    { id: 'P4-L3', severity: 'P4', tier: 'L3', responseMins: 60, resolutionMins: 360 }
  ];
  private readonly nextIncidentNumber = signal(104);
  private readonly serverIdByUiId = signal<Record<string, string>>({});
  private readonly incidentApi = inject(IncidentApiService);

  constructor() {
    this.loadIncidentsFromServer();
    this.loadSlaTargetsFromServer();
    this.loadSlaSnapshotsFromServer();
  }

  readonly incidents = signal<Incident[]>([]);

  readonly allIncidents = signal<Incident[]>([]);

  readonly incidentHistory = signal<IncidentHistory[]>([]);

  // Pagination signals
  readonly currentPage = signal(1);
  readonly pageSize = signal(10);
  readonly totalIncidents = signal(0);
  readonly totalPages = signal(0);
  readonly isLoadingPage = signal(false);

  readonly slaTargets = signal<SlaTargetRecord[]>(CommandCenterStore.DEFAULT_SLA_TARGETS);

  readonly slaSnapshots = signal<SlaSnapshotRecord[]>([]);

  readonly monthlySlaTargetPercent = CommandCenterStore.MONTHLY_SLA_TARGET_PERCENT;

  readonly members = signal<TeamMember[]>([
    { name: 'Alex Chen', level: 'L1', skills: 'Spark, SQL, Grafana', cert: 70, oncall: true },
    { name: 'Jamie Lin', level: 'L2', skills: 'Dynatrace, Kafka, Airflow', cert: 85, oncall: true },
    { name: 'Taylor Smith', level: 'L3', skills: 'Databricks, MLflow, Architecture', cert: 94, oncall: true },
    { name: 'Jordan Lee', level: 'L1', skills: 'Delta Lake, Python', cert: 60, oncall: false },
    { name: 'Riley Kim', level: 'L2', skills: 'Cloud (AWS), dbt', cert: 78, oncall: false },
    { name: 'Morgan Zhao', level: 'L3', skills: 'Security, FinOps', cert: 88, oncall: false }
  ]);

  readonly coveragePlatforms = [
    'Databricks',
    'Dynatrace',
    'Kafka',
    'Airflow',
    'Delta Lake',
    'MLflow',
    'Cloud',
    'Security',
    'FinOps'
  ];

  readonly coverageData: Record<string, CoverageLevel[]> = {
    Databricks: ['Full', 'Partial', 'Full', 'Partial', 'Full', 'Full', 'Full', 'Partial', 'Partial'],
    Dynatrace: ['Partial', 'Full', 'None', 'Partial', 'None', 'Partial', 'Full', 'Full', 'None'],
    Kafka: ['Full', 'Partial', 'Full', 'Full', 'Partial', 'None', 'Full', 'None', 'Partial'],
    Airflow: ['Partial', 'Partial', 'Full', 'Full', 'Partial', 'None', 'Full', 'None', 'Partial'],
    'Delta Lake': ['Full', 'None', 'Partial', 'Partial', 'Full', 'None', 'Full', 'None', 'None'],
    MLflow: ['Full', 'None', 'None', 'None', 'Partial', 'Full', 'Partial', 'Partial', 'None'],
    Cloud: ['Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full', 'Full'],
    Security: ['Partial', 'Full', 'Partial', 'None', 'Partial', 'Partial', 'Full', 'Full', 'None'],
    FinOps: ['None', 'None', 'Partial', 'None', 'None', 'None', 'Full', 'None', 'Full']
  };

  readonly rosterDays: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

  readonly weeklyRoster: Record<Tier, string[]> = {
    L1: ['Alex', 'Alex', 'Jordan', 'Jordan', 'Sam', 'Sam', 'Alex'],
    L2: ['Jamie', 'Jamie', 'Taylor', 'Taylor', 'Riley', 'Riley', 'Jamie'],
    L3: ['Morgan', 'Morgan', 'Casey', 'Casey', 'Morgan', 'Casey', 'Morgan']
  };

  readonly rosterRows = computed<RosterRow[]>(() => [
    { role: 'L1', shifts: this.weeklyRoster.L1 },
    { role: 'L2', shifts: this.weeklyRoster.L2 },
    { role: 'L3', shifts: this.weeklyRoster.L3 }
  ]);

  readonly todayRosterIndex = computed(() => (new Date().getDay() + 6) % 7);

  readonly todayRosterDay = computed<Weekday>(() => this.rosterDays[this.todayRosterIndex()]);

  readonly todaysOnCall = computed<Record<Tier, string>>(() => {
    const index = this.todayRosterIndex();
    return {
      L1: this.weeklyRoster.L1[index],
      L2: this.weeklyRoster.L2[index],
      L3: this.weeklyRoster.L3[index]
    };
  });

  readonly todaysOnCallSummary = computed(() => {
    const today = this.todaysOnCall();
    return `Today's On-Call (${this.todayRosterDay()}): L1: ${today.L1} / L2: ${today.L2} / L3: ${today.L3}`;
  });

  readonly openIncidentCount = computed(() => this.incidents().length);

  readonly incidentVolume = computed<ChartSeries>(() => {
    const records = this.allIncidentRecords();
    const days = this.lastSevenDays();
    const counts = new Map<string, number>(days.map((day) => [day.key, 0]));

    for (const record of records) {
      const key = this.toDateKey(record.openedAt);
      if (counts.has(key)) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    return {
      labels: days.map((day) => day.label),
      values: days.map((day) => counts.get(day.key) ?? 0)
    };
  });

  readonly platformBreakdown = computed<ChartSeries>(() => {
    const records = this.allIncidentRecords();
    const counts = { Databricks: 0, Dynatrace: 0, Other: 0 };

    for (const record of records) {
      if (record.platform === 'Databricks') {
        counts.Databricks += 1;
      } else if (record.platform === 'Dynatrace') {
        counts.Dynatrace += 1;
      } else {
        counts.Other += 1;
      }
    }

    return {
      labels: ['Databricks', 'Dynatrace', 'Other'],
      values: [counts.Databricks, counts.Dynatrace, counts.Other]
    };
  });

  readonly platformSummary = computed(() => {
    const series = this.platformBreakdown();
    const total = series.values.reduce((sum, value) => sum + value, 0) || 1;

    return series.labels
      .map((label, index) => `${label} ${Math.round((series.values[index] / total) * 100)}%`)
      .join(' · ');
  });
  readonly mttr = computed(() => {
    const resolved = this.incidentHistory().map((item) => item.resolvedMins);
    if (resolved.length === 0) {
      return 0;
    }

    const sum = resolved.reduce((acc, value) => acc + value, 0);
    return Math.round(sum / resolved.length);
  });
  readonly resolved7d = computed(() => {
    const now = Date.now();
    const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
    return this.incidentHistory().filter((item) => (item.resolvedAtMs ?? 0) >= sevenDaysAgo).length;
  });

  readonly monthlySlaCompliance = computed(() => {
    const { startMs, endMs } = this.currentMonthBounds();
    const resolvedThisMonth = this.incidentHistory().filter((incident) => {
      const resolvedAt = incident.resolvedAtMs ?? 0;
      return resolvedAt >= startMs && resolvedAt < endMs;
    });

    const totalIncidents = resolvedThisMonth.length;
    const metIncidents = resolvedThisMonth.filter((incident) => this.isIncidentWithinSla(incident)).length;
    const compliancePercent = totalIncidents === 0
      ? 100
      : this.toSingleDecimal((metIncidents / totalIncidents) * 100);

    return {
      totalIncidents,
      metIncidents,
      compliancePercent
    };
  });

  readonly monthlySlaCompliancePercent = computed(() => this.monthlySlaCompliance().compliancePercent);

  readonly latestRolling48hSnapshot = computed(() => {
    const snapshots = this.slaSnapshots().filter((snapshot) => snapshot.kind === 'rolling-48h');
    if (snapshots.length > 0) {
      return snapshots.reduce((latest, current) => (
        current.windowEndMs > latest.windowEndMs ? current : latest
      ));
    }

    // Fallback for when snapshot persistence is empty/unavailable.
    const now = Date.now();
    const rollingStart = now - CommandCenterStore.FORTY_EIGHT_HOURS_MS;
    return this.buildSlaSnapshot('rolling-48h', rollingStart, now, null, now);
  });

  readonly incidentHistoryView = computed<IncidentHistoryViewRow[]>(() => {
    const activeRows: IncidentHistoryViewRow[] = this.incidents().map((item) => ({
      id: item.id,
      platform: item.platform,
      severity: item.severity,
      tier: item.tier,
      resolvedMins: null,
      resolvedAt: null,
      resolvedAtMs: null,
      status: item.status,
      openedAt: item.openedAt,
      opened: item.opened,
      error: item.error,
      solution: item.solution,
      tags: item.tags
    }));

    const resolvedRows: IncidentHistoryViewRow[] = this.incidentHistory().map((item) => ({
      id: item.id,
      platform: item.platform,
      severity: item.severity,
      tier: item.tier,
      resolvedMins: item.resolvedMins,
      resolvedAt: item.resolvedAt,
      resolvedAtMs: item.resolvedAtMs,
      status: 'Resolved',
      openedAt: item.openedAt,
      opened: item.opened,
      error: item.error,
      solution: item.solution,
      tags: item.tags
    }));

    return [...resolvedRows, ...activeRows].sort((a, b) => {
      const leftTimestamp = a.resolvedAtMs ?? a.openedAt;
      const rightTimestamp = b.resolvedAtMs ?? b.openedAt;

      if (a.status !== b.status) {
        if (a.status === 'Resolved') {
          return -1;
        }

        if (b.status === 'Resolved') {
          return 1;
        }
      }

      return rightTimestamp - leftTimestamp;
    });
  });

  readonly paginatedActiveIncidents = computed<Incident[]>(() => {
    const active = this.incidents();
    const pageSize = this.pageSize();
    const currentPage = this.currentPage();
    
    // Update total counts
    const total = active.length;
    const totalPages = Math.ceil(total / pageSize);
    
    this.totalIncidents.set(total);
    this.totalPages.set(totalPages);
    
    // Calculate pagination
    const start = (currentPage - 1) * pageSize;
    const end = start + pageSize;
    
    return active.slice(start, end);
  });

  async createIncident(payload: { platform: string; severity: Severity; tier: Tier; env: Environment; errorLog: string }): Promise<string> {
    const now = Date.now();
    const errorDescription = payload.errorLog || 'No details';
    const draftIncident = {
      platform: payload.platform,
      severity: payload.severity,
      tier: payload.tier,
      env: payload.env,
      status: 'Active' as const,
      opened: new Date(now).toLocaleString(),
      openedAt: now,
      resolvedMins: null,
      resolvedAt: null,
      resolvedAtMs: null,
      error: errorDescription,
      solution: '',
      tags: [] as string[]
    };

    const incidentWithTags: Omit<IncidentRecord, 'id'> = {
      ...draftIncident,
      tags: this.generateIncidentTags(
        {
          id: '',
          ...draftIncident
        },
        ''
      )
    };

    try {
      const createdIncident = await new Promise<IncidentRecord>((resolve, reject) => {
        this.incidentApi.createIncident(incidentWithTags).subscribe({
          next: resolve,
          error: reject
        });
      });

      const incident: Incident = {
        ...incidentWithTags,
        id: createdIncident.id
        ,
        status: 'Active'
      };

      this.allIncidents.update((items) => [...items, incident]);
      this.incidents.update((items) => [...items, incident]);
      return incident.id;
    } catch {
      const fallbackId = `tmp-${now}`;
      const incident: Incident = {
        ...incidentWithTags,
        id: fallbackId
        ,
        status: 'Active'
      };

      this.allIncidents.update((items) => [...items, incident]);
      this.incidents.update((items) => [...items, incident]);
      return incident.id;
    }
  }

  resolveIncident(id: string, solution = ''): Promise<boolean> {
    const active = this.allIncidents();
    const target = active.find((item) => item.id === id);
    const resolvedSolution = solution.trim();
    if (!target || target.status !== 'Being Resolved' || !resolvedSolution) {
      return Promise.resolve(false);
    }

    const tags = this.generateIncidentTags(target, resolvedSolution);
    const resolvedAtMs = Date.now();
    const resolvedAt = new Date(resolvedAtMs).toLocaleString();
    const resolvedMins = this.calculateResolvedMinutes(target.openedAt, resolvedAtMs);
    const historyRow: IncidentHistory = {
      id: target.id,
      platform: target.platform,
      severity: target.severity,
      tier: target.tier,
      env: target.env,
      openedAt: target.openedAt,
      opened: target.opened,
      resolvedAt,
      resolvedAtMs,
      resolvedMins,
      error: target.error,
      solution: resolvedSolution,
      tags,
      status: 'Resolved'
    };

    const updatePayload: IncidentRecord = {
      ...historyRow,
      resolvedMins,
      resolvedAt,
      resolvedAtMs,
      solution: resolvedSolution,
      tags,
      status: 'Resolved'
    };

    const mappedServerId = this.serverIdByUiId()[id];
    const candidateServerIds = mappedServerId && mappedServerId !== id
      ? [mappedServerId, id]
      : [id];

    return new Promise((resolve) => {
      this.persistResolvedIncident(candidateServerIds, id, historyRow, updatePayload, resolve);
    });
  }

  acknowledgeIncident(id: string): Promise<boolean> {
    const active = this.allIncidents();
    const target = active.find((item) => item.id === id);
    if (!target) {
      return Promise.resolve(false);
    }

    if (target.status === 'Being Resolved') {
      return Promise.resolve(true);
    }

    const acknowledged: Incident = {
      ...target,
      status: 'Being Resolved'
    };
    const payload: IncidentRecord = {
      ...target,
      status: 'Being Resolved'
    };

    const mappedServerId = this.serverIdByUiId()[id];
    const candidateServerIds = mappedServerId && mappedServerId !== id
      ? [mappedServerId, id]
      : [id];

    return new Promise((resolve) => {
      this.persistAcknowledgedIncident(candidateServerIds, id, acknowledged, payload, resolve);
    });
  }

  private persistAcknowledgedIncident(
    candidateServerIds: string[],
    uiIncidentId: string,
    acknowledged: Incident,
    payload: IncidentRecord,
    done: (success: boolean) => void
  ): void {
    const [currentServerId, ...remainingIds] = candidateServerIds;

    this.incidentApi.updateIncident(currentServerId, payload).subscribe({
      next: () => {
          this.allIncidents.update((items) => items.map((item) => (item.id === uiIncidentId ? acknowledged : item)));
        this.incidents.update((items) => items.map((item) => (item.id === uiIncidentId ? acknowledged : item)));
        this.loadIncidentsFromServer();
        done(true);
      },
      error: () => {
        if (remainingIds.length > 0) {
          this.persistAcknowledgedIncident(remainingIds, uiIncidentId, acknowledged, payload, done);
          return;
        }

        this.loadIncidentsFromServer();
        done(false);
      }
    });
  }

  private persistResolvedIncident(
    candidateServerIds: string[],
    uiIncidentId: string,
    historyRow: IncidentHistory,
    payload: IncidentRecord,
    done: (success: boolean) => void
  ): void {
    const [currentServerId, ...remainingIds] = candidateServerIds;

    this.incidentApi.updateIncident(currentServerId, payload).subscribe({
      next: () => {
        this.allIncidents.update((items) => items.filter((item) => item.id !== uiIncidentId));
        this.incidents.update((items) => items.filter((item) => item.id !== uiIncidentId));
        this.incidentHistory.update((items) => [...items, historyRow]);
        this.loadIncidentsFromServer();
        done(true);
      },
      error: () => {
        if (remainingIds.length > 0) {
          this.persistResolvedIncident(remainingIds, uiIncidentId, historyRow, payload, done);
          return;
        }

        this.loadIncidentsFromServer();
        done(false);
      }
    });
  }

  private loadIncidentsFromServer(): void {
    // Load all incidents once and keep in memory for client-side pagination/filtering
    this.incidentApi
      .getIncidents()
      .pipe(catchError(() => of([] as IncidentRecord[])))
      .subscribe((records: IncidentRecord[]) => {
        if (records.length === 0) {
                    this.allIncidents.set([]);
          this.incidents.set([]);
          this.incidentHistory.set([]);
          this.totalIncidents.set(0);
          this.totalPages.set(1);
          this.refreshSlaSnapshots();
          return;
        }

        this.syncFromRecords(records);
        // Update total counts
        this.totalIncidents.set(this.incidents().length);
        this.totalPages.set(Math.ceil(this.incidents().length / this.pageSize()));
      });
  }

  loadIncidentsPage(page: number, filters?: { platform?: string; severity?: string; tier?: string; status?: string; search?: string }): void {
    try {

      // Get all incidents from store (not just current page)
      let filteredIncidents = [...this.allIncidents()];

      // Apply client-side filters
      if (filters?.platform && filters.platform !== 'All') {
        filteredIncidents = filteredIncidents.filter((inc) => inc.platform === filters.platform);
      }
      if (filters?.severity && filters.severity !== 'All') {
        filteredIncidents = filteredIncidents.filter((inc) => inc.severity === filters.severity);
      }
      if (filters?.tier && filters.tier !== 'All') {
        filteredIncidents = filteredIncidents.filter((inc) => inc.tier === filters.tier);
      }
      if (filters?.status && filters.status !== 'All') {
        filteredIncidents = filteredIncidents.filter((inc) => inc.status === filters.status);
      }

      // Apply search filter if provided
      if (filters?.search && filters.search.trim()) {
        const query = filters.search.toLowerCase();
        filteredIncidents = filteredIncidents.filter(
          (inc) =>
            inc.id.toLowerCase().includes(query) ||
            inc.platform.toLowerCase().includes(query) ||
            inc.severity.toLowerCase().includes(query) ||
            inc.tier.toLowerCase().includes(query) ||
            inc.error.toLowerCase().includes(query) ||
            inc.tags.some((tag) => tag.toLowerCase().includes(query))
        );
      }

      // Sort by opened timestamp descending
      filteredIncidents.sort((a, b) => b.openedAt - a.openedAt);

      // Calculate pagination
      const pageSize = this.pageSize();
      const totalPages = Math.max(1, Math.ceil(filteredIncidents.length / pageSize));
      const validPage = Math.max(1, Math.min(page, totalPages));
      const startIdx = (validPage - 1) * pageSize;
      const endIdx = startIdx + pageSize;
      const pageData = filteredIncidents.slice(startIdx, endIdx);

      // Update store state
      this.incidents.set(pageData);
      this.currentPage.set(validPage);
      this.totalIncidents.set(filteredIncidents.length);
      this.totalPages.set(totalPages);
    } catch (error) {
      console.error('Failed to load incidents page:', error);
      this.incidents.set([]);
    }
  }

  nextPage(filters?: { platform?: string; severity?: string; tier?: string; status?: string; search?: string }): void {
    const nextPage = this.currentPage() + 1;
    if (nextPage <= this.totalPages()) {
      this.loadIncidentsPage(nextPage, filters);
    }
  }

  previousPage(filters?: { platform?: string; severity?: string; tier?: string; status?: string; search?: string }): void {
    const prevPage = this.currentPage() - 1;
    if (prevPage >= 1) {
      this.loadIncidentsPage(prevPage, filters);
    }
  }

  goToPage(page: number, filters?: { platform?: string; severity?: string; tier?: string; status?: string; search?: string }): void {
    if (page >= 1) {
      this.loadIncidentsPage(page, filters);
    }
  }

  private loadSlaTargetsFromServer(): void {
    this.incidentApi
      .getSlaTargets()
      .pipe(catchError(() => of([] as SlaTargetRecord[])))
      .subscribe((records: SlaTargetRecord[]) => {
        if (records.length === 0) {
          this.seedDefaultSlaTargets();
          this.refreshSlaSnapshots();
          return;
        }

        this.slaTargets.set(records);
        this.refreshSlaSnapshots();
      });
  }

  private loadSlaSnapshotsFromServer(): void {
    this.incidentApi
      .getSlaSnapshots()
      .pipe(catchError(() => of([] as SlaSnapshotRecord[])))
      .subscribe((records: SlaSnapshotRecord[]) => {
        this.slaSnapshots.set(records);
      });
  }

  private seedDefaultSlaTargets(): void {
    for (const target of CommandCenterStore.DEFAULT_SLA_TARGETS) {
      this.incidentApi.upsertSlaTarget(target).subscribe({ error: () => undefined });
    }
  }

  private syncFromRecords(records: IncidentRecord[]): void {
    const normalizedRecords = records.map((record) => this.normalizeRecord(record));

    const activeRecords = normalizedRecords.filter((record) => record.status !== 'Resolved') as Incident[];
    const resolvedRecords = normalizedRecords.filter((record) => record.status === 'Resolved') as IncidentHistory[];

    const idMap: Record<string, string> = {};
    const length = Math.min(records.length, normalizedRecords.length);
    for (let index = 0; index < length; index += 1) {
      idMap[normalizedRecords[index].id] = records[index].id;
    }
    this.serverIdByUiId.set(idMap);

    this.allIncidents.set(activeRecords);
    this.incidents.set(activeRecords);
    this.incidentHistory.set(resolvedRecords);

    const highestId = normalizedRecords.reduce((max, record) => {
      const numericId = this.parseIncidentNumber(record.id);
      return numericId === null ? max : Math.max(max, numericId);
    }, 103);

    this.nextIncidentNumber.set(highestId + 1);
    this.refreshSlaSnapshots();
  }
  private normalizeRecord(record: IncidentRecord): IncidentRecord {

    const normalizedOpenedAt = Number.isFinite(record.openedAt)
      ? record.openedAt
      : Date.now();
    const normalizedOpened = record.opened || new Date(normalizedOpenedAt).toLocaleString();
    const normalizedResolvedAtMs = record.status === 'Resolved'
      ? (this.resolveResolvedAtMs(record) ?? normalizedOpenedAt)
      : null;
    const normalizedResolvedAt = normalizedResolvedAtMs === null
      ? null
      : (record.resolvedAt || new Date(normalizedResolvedAtMs).toLocaleString());
    const normalizedResolvedMins = normalizedResolvedAtMs === null
      ? null
      : this.calculateResolvedMinutes(normalizedOpenedAt, normalizedResolvedAtMs);

    return {
      ...record,
      id: record.id,
      openedAt: normalizedOpenedAt,
      opened: normalizedOpened,
      resolvedAtMs: normalizedResolvedAtMs,
      resolvedAt: normalizedResolvedAt,
      resolvedMins: normalizedResolvedMins
    };
  }

  private resolveResolvedAtMs(record: IncidentRecord): number | null {
    if (typeof record.resolvedAtMs === 'number' && Number.isFinite(record.resolvedAtMs)) {
      return record.resolvedAtMs;
    }

    if (record.resolvedAt) {
      const parsed = Date.parse(record.resolvedAt);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }

    return null;
  }

  private calculateResolvedMinutes(openedAt: number, resolvedAtMs: number): number {
    const openedAtMinute = openedAt - (openedAt % 60000);
    const resolvedAtMinute = resolvedAtMs - (resolvedAtMs % 60000);
    const diffMs = Math.max(0, resolvedAtMinute - openedAtMinute);
    return Math.max(1, Math.floor(diffMs / 60000));
  }

  private parseIncidentNumber(id: string): number | null {
    const match = id.match(CommandCenterStore.PROFESSIONAL_ID_PATTERN);
    if (!match) {
      return null;
    }

    const number = Number.parseInt(match[1], 10);
    return Number.isNaN(number) ? null : number;
  }

  private formatIncidentId(number: number): string {
    return `INC-${String(number).padStart(3, '0')}`;
  }

  private generateIncidentTags(incident: Incident, solution: string): string[] {
    const baseTags = [
      incident.platform,
      incident.severity,
      incident.tier,
      incident.env
    ].map((tag) => tag.toLowerCase());

    const keywordTags = this.extractKeywords(`${incident.error} ${solution}`);
    return [...new Set([...baseTags, ...keywordTags])].slice(0, 10);
  }

  private extractKeywords(text: string): string[] {
    const stopWords = new Set([
      'the', 'and', 'for', 'from', 'with', 'that', 'this', 'used', 'used', 'due', 'error',
      'incident', 'log', 'logs', 'details', 'no', 'null', 'was', 'were', 'has', 'have',
      'been', 'into', 'than', 'then', 'task', 'failed', 'failure', 're-run', 'rerun', 're', 'on', 'of', 'to'
    ]);

    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((word) => word.trim())
      .filter((word) => word.length > 3 && !stopWords.has(word))
      .filter((word, index, words) => words.indexOf(word) === index)
      .slice(0, 6);
  }

  private currentMonthBounds(): { startMs: number; endMs: number } {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { startMs: start.getTime(), endMs: end.getTime() };
  }

  private buildMonthKey(timestamp: number): string {
    const date = new Date(timestamp);
    const month = String(date.getMonth() + 1).padStart(2, '0');
    return `${date.getFullYear()}-${month}`;
  }

  private findSlaTarget(severity: Severity, tier: Tier): SlaTargetRecord | null {
    return this.slaTargets().find((target) => target.severity === severity && target.tier === tier) ?? null;
  }

  private isIncidentWithinSla(incident: IncidentHistory): boolean {
    const target = this.findSlaTarget(incident.severity, incident.tier);
    if (!target) {
      return false;
    }

    return incident.resolvedMins <= target.resolutionMins;
  }

  private toSingleDecimal(value: number): number {
    return Math.round(value * 10) / 10;
  }

  private refreshSlaSnapshots(): void {
    const now = Date.now();
    const rollingStart = now - CommandCenterStore.FORTY_EIGHT_HOURS_MS;
    const rollingSnapshot = this.buildSlaSnapshot('rolling-48h', rollingStart, now, null, now);
    this.persistSlaSnapshot(rollingSnapshot);

    const { startMs, endMs } = this.currentMonthBounds();
    const monthKey = this.buildMonthKey(startMs);
    const monthlySnapshot = this.buildSlaSnapshot('monthly', startMs, endMs, monthKey, now);
    this.persistSlaSnapshot(monthlySnapshot);
  }

  private buildSlaSnapshot(
    kind: 'rolling-48h' | 'monthly',
    windowStartMs: number,
    windowEndMs: number,
    monthKey: string | null,
    calculatedAtMs: number
  ): SlaSnapshotRecord {
    const eligibleResolved = this.incidentHistory().filter((incident) => {
      const resolvedAtMs = incident.resolvedAtMs ?? 0;
      return resolvedAtMs >= windowStartMs && resolvedAtMs < windowEndMs;
    });

    const totalIncidents = eligibleResolved.length;
    const metIncidents = eligibleResolved.filter((incident) => this.isIncidentWithinSla(incident)).length;
    const compliancePercent = totalIncidents === 0
      ? 100
      : this.toSingleDecimal((metIncidents / totalIncidents) * 100);

    const id = kind === 'rolling-48h'
      ? `rolling-48h-${Math.floor(windowEndMs / CommandCenterStore.FORTY_EIGHT_HOURS_MS)}`
      : `monthly-${monthKey}`;

    return {
      id,
      kind,
      windowStartMs,
      windowEndMs,
      totalIncidents,
      metIncidents,
      compliancePercent,
      calculatedAtMs,
      monthKey
    };
  }

  private persistSlaSnapshot(snapshot: SlaSnapshotRecord): void {
    const existing = this.slaSnapshots().find((item) => item.id === snapshot.id);
    const unchanged = !!existing
      && existing.totalIncidents === snapshot.totalIncidents
      && existing.metIncidents === snapshot.metIncidents
      && existing.compliancePercent === snapshot.compliancePercent
      && existing.windowStartMs === snapshot.windowStartMs
      && existing.windowEndMs === snapshot.windowEndMs;

    if (unchanged) {
      return;
    }

    // Optimistic local update so dashboard reflects latest SLA instantly.
    this.slaSnapshots.update((items) => {
      const index = items.findIndex((item) => item.id === snapshot.id);
      if (index === -1) {
        return [...items, snapshot];
      }

      const next = [...items];
      next[index] = snapshot;
      return next;
    });

    this.incidentApi.upsertSlaSnapshot(snapshot).subscribe({
      next: (saved) => {
        this.slaSnapshots.update((items) => {
          const index = items.findIndex((item) => item.id === saved.id);
          if (index === -1) {
            return [...items, saved];
          }

          const next = [...items];
          next[index] = saved;
          return next;
        });
      },
      error: () => undefined
    });
  }

  private allIncidentRecords(): Array<{ platform: string; openedAt: number }> {
    const unique = new Map<string, { platform: string; openedAt: number }>();

    for (const incident of this.incidents()) {
      unique.set(incident.id, { platform: incident.platform, openedAt: incident.openedAt });
    }

    for (const resolved of this.incidentHistory()) {
      unique.set(resolved.id, { platform: resolved.platform, openedAt: resolved.openedAt });
    }

    return [...unique.values()];
  }

  private lastSevenDays(): Array<{ key: string; label: string }> {
    const today = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { weekday: 'short' });
    const result: Array<{ key: string; label: string }> = [];

    for (let offset = 6; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - offset);
      result.push({ key: this.toDateKey(date.getTime()), label: formatter.format(date) });
    }

    return result;
  }

  private toDateKey(value: number): string {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }
}
