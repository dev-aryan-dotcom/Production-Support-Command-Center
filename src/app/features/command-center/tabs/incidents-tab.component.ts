import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CommandCenterStore, IncidentHistoryViewRow } from '../data/command-center.store';
import { Environment, Severity, Tier } from '../data/command-center.models';
import { jsPDF } from 'jspdf';

type ExportFormat = 'excel' | 'csv' | 'json';
type IncidentExportFormat = 'pdf' | 'json';

@Component({
  selector: 'app-incidents-tab',
  imports: [ReactiveFormsModule],
  templateUrl: './incidents-tab.component.html',
  styleUrl: './incidents-tab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class IncidentsTabComponent {
  private readonly fb = inject(FormBuilder);
  private readonly store = inject(CommandCenterStore);
  private messageTimeoutId?: number;
  private exportNotificationTimeoutId?: number;
  readonly formSubmitted = signal(false);

  readonly history = this.store.incidentHistoryView;
  readonly successMessage = signal('');
  readonly exportNotification = signal('');
  readonly historySearch = signal('');
  readonly platformFilter = signal('All');
  readonly severityFilter = signal('All');
  readonly tierFilter = signal('All');
  readonly statusFilter = signal('All');
  readonly expandedHistoryId = signal<string | null>(null);
  readonly selectedExportFormat = signal<ExportFormat>('excel');
  readonly filteredHistory = computed(() => {
    const query = this.historySearch().trim().toLowerCase();
    const selectedPlatform = this.platformFilter();
    const selectedSeverity = this.severityFilter();
    const selectedTier = this.tierFilter();
    const selectedStatus = this.statusFilter();
    const items = this.history().filter((entry) => {
      const matchesPlatform = selectedPlatform === 'All' || entry.platform === selectedPlatform;
      const matchesSeverity = selectedSeverity === 'All' || entry.severity === selectedSeverity;
      const matchesTier = selectedTier === 'All' || entry.tier === selectedTier;
      const matchesStatus = selectedStatus === 'All' || entry.status === selectedStatus;

      return matchesPlatform && matchesSeverity && matchesTier && matchesStatus;
    });

    if (!query) {
      return items;
    }

    const tokens = query.split(/\s+/).filter(Boolean);

    return items
      .map((entry) => ({ entry, score: this.scoreHistoryEntry(entry, tokens) }))
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score || right.entry.openedAt - left.entry.openedAt)
      .map(({ entry }) => entry);
  });

  readonly platformOptions = ['Databricks', 'Dynatrace', 'Kafka', 'Airflow', 'dbt'];
  readonly severityOptions: Severity[] = ['P1', 'P2', 'P3', 'P4'];
  readonly tierOptions: Tier[] = ['L1', 'L2', 'L3'];
  readonly statusOptions: Array<'Active' | 'Being Resolved' | 'Resolved'> = ['Active', 'Being Resolved', 'Resolved'];
  readonly exportFormatOptions: Array<{ label: string; value: ExportFormat }> = [
    { label: 'Excel (.xls)', value: 'excel' },
    { label: 'CSV (.csv)', value: 'csv' },
    { label: 'JSON (.json)', value: 'json' }
  ];
  readonly envOptions = ['Prod', 'Staging', 'Dev'];

  readonly form = this.fb.nonNullable.group({
    platform: this.fb.nonNullable.control('', [Validators.required]),
    severity: this.fb.nonNullable.control('', [Validators.required]),
    tier: this.fb.nonNullable.control('', [Validators.required]),
    env: this.fb.nonNullable.control('', [Validators.required]),
    errorLog: this.fb.nonNullable.control('', [Validators.required, Validators.maxLength(150)])
  });

  async createIncident(): Promise<void> {
    this.formSubmitted.set(true);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const incidentId = await this.store.createIncident({
      platform: value.platform,
      severity: value.severity as Severity,
      tier: value.tier as Tier,
      env: value.env as Environment,
      errorLog: value.errorLog
    });

    this.form.reset();
    this.formSubmitted.set(false);
    this.successMessage.set(`Incident ${incidentId} logged successfully. It is now visible on the Dashboard.`);

    if (this.messageTimeoutId) {
      window.clearTimeout(this.messageTimeoutId);
    }

    this.messageTimeoutId = window.setTimeout(() => {
      this.successMessage.set('');
    }, 4000);
  }

  clearHistorySearch(): void {
    this.historySearch.set('');
  }

  clearHistoryFilters(): void {
    this.platformFilter.set('All');
    this.severityFilter.set('All');
    this.tierFilter.set('All');
    this.statusFilter.set('All');
  }

  hasActiveHistoryFilters(): boolean {
    return [this.platformFilter(), this.severityFilter(), this.tierFilter(), this.statusFilter()].some((value) => value !== 'All');
  }

  isFieldInvalid(fieldName: 'platform' | 'severity' | 'tier' | 'env' | 'errorLog'): boolean {
    const control = this.form.controls[fieldName];

    return control.invalid && (control.touched || this.formSubmitted());
  }

  getErrorLogMaxLength(): number {
    return 150;
  }

  getErrorLogRemainingCharacters(): number {
    const value = this.form.controls.errorLog.value ?? '';

    return Math.max(this.getErrorLogMaxLength() - value.length, 0);
  }

  toggleHistoryDetails(id: string): void {
    this.expandedHistoryId.update((current) => (current === id ? null : id));
  }

  isHistoryExpanded(id: string): boolean {
    return this.expandedHistoryId() === id;
  }

  exportAllHistory(): void {
    const records = this.filteredHistory();
    if (records.length === 0) {
      this.showExportNotification('No incidents are there to export.');
      return;
    }

    const format = this.selectedExportFormat();
    this.downloadRecords(records, format, 'incident-history');
    this.showExportNotification(`Exported ${records.length} incident(s) as ${format.toUpperCase()}`);
  }

  exportIncident(entry: IncidentHistoryViewRow, format: IncidentExportFormat): void {
    const safeId = entry.id.toLowerCase().replace(/[^a-z0-9-]/g, '-');
    if (format === 'json') {
      this.downloadRecords([entry], 'json', `incident-${safeId}`);
      this.showExportNotification(`Incident ${entry.id} exported as JSON`);
      return;
    }

    this.downloadIncidentPdf(entry, `incident-${safeId}`);
    this.showExportNotification(`Incident ${entry.id} exported as PDF`);
  }

  onIncidentExportSelect(entry: IncidentHistoryViewRow, event: Event): void {
    const select = event.target as HTMLSelectElement;
    const value = select.value as IncidentExportFormat | '';

    if (!value) {
      return;
    }

    this.exportIncident(entry, value);
    select.value = '';
  }

  private downloadRecords(records: IncidentHistoryViewRow[], format: ExportFormat, namePrefix: string): void {
    if (records.length === 0) {
      return;
    }

    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const filename = `${namePrefix}-${timestamp}`;

    if (format === 'json') {
      const payload = JSON.stringify(records, null, 2);
      this.triggerDownload(`${filename}.json`, payload, 'application/json;charset=utf-8');
      return;
    }

    if (format === 'csv') {
      const payload = this.toCsv(records);
      this.triggerDownload(`${filename}.csv`, payload, 'text/csv;charset=utf-8');
      return;
    }

    const payload = this.toExcelTable(records);
    this.triggerDownload(`${filename}.xls`, payload, 'application/vnd.ms-excel;charset=utf-8');
  }

  private toCsv(records: IncidentHistoryViewRow[]): string {
    const headers = ['id', 'platform', 'severity', 'tier', 'status', 'opened', 'resolvedAt', 'resolvedMins', 'error', 'solution', 'tags'];
    const rows = records.map((record) => [
      record.id,
      record.platform,
      record.severity,
      record.tier,
      record.status,
      record.opened,
      record.resolvedAt ?? '',
      record.resolvedMins ?? '',
      record.error,
      record.solution,
      record.tags.join('|')
    ]);

    return [headers, ...rows]
      .map((row) => row.map((value) => this.escapeCsv(String(value))).join(','))
      .join('\n');
  }

  private escapeCsv(value: string): string {
    const normalized = value.replace(/\r?\n/g, ' ').replace(/"/g, '""');
    return `"${normalized}"`;
  }

  private toExcelTable(records: IncidentHistoryViewRow[]): string {
    const rows = records.map((record) => `
      <tr>
        <td>${this.escapeHtml(record.id)}</td>
        <td>${this.escapeHtml(record.platform)}</td>
        <td>${this.escapeHtml(record.severity)}</td>
        <td>${this.escapeHtml(record.tier)}</td>
        <td>${this.escapeHtml(record.status)}</td>
        <td>${this.escapeHtml(record.opened)}</td>
        <td>${this.escapeHtml(record.resolvedAt ?? '')}</td>
        <td>${this.escapeHtml(String(record.resolvedMins ?? ''))}</td>
        <td>${this.escapeHtml(record.error)}</td>
        <td>${this.escapeHtml(record.solution)}</td>
        <td>${this.escapeHtml(record.tags.join(', '))}</td>
      </tr>
    `).join('');

    return `
      <html>
        <head>
          <meta charset="UTF-8" />
        </head>
        <body>
          <table border="1">
            <thead>
              <tr>
                <th>ID</th>
                <th>Platform</th>
                <th>Severity</th>
                <th>Tier</th>
                <th>Status</th>
                <th>Opened</th>
                <th>Resolved At</th>
                <th>Resolved (mins)</th>
                <th>Description</th>
                <th>Solution</th>
                <th>Tags</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </body>
      </html>
    `;
  }

  private downloadIncidentPdf(record: IncidentHistoryViewRow, namePrefix: string): void {
    const now = new Date();
    const timestamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const fileName = `${namePrefix}-${timestamp}.pdf`;
    const document = new jsPDF({ unit: 'pt', format: 'a4' });

    const pageWidth = 595;
    const pageHeight = 842;
    const marginX = 36;
    let yPosition = 0;
    const safeSolution = record.solution || 'Solution not provided.';
    const tagsText = record.tags.length > 0 ? record.tags.join(', ') : 'No tags available.';

    const severityColorMap: Record<Severity, [number, number, number]> = {
      P1: [185, 28, 28],
      P2: [194, 65, 12],
      P3: [133, 77, 14],
      P4: [3, 105, 161]
    };

    const addNewPage = () => {
      document.addPage();
      document.setFillColor(246, 248, 252);
      document.rect(0, 0, pageWidth, pageHeight, 'F');
      yPosition = 48;
    };

    const ensureSpace = (needed: number) => {
      if (yPosition + needed > pageHeight - 44) {
        addNewPage();
      }
    };

    document.setFillColor(246, 248, 252);
    document.rect(0, 0, pageWidth, pageHeight, 'F');

    document.setFillColor(30, 74, 107);
    document.rect(0, 0, pageWidth, 100, 'F');

    document.setTextColor(255, 255, 255);
    document.setFont('helvetica', 'bold');
    document.setFontSize(20);
    document.text('Incident Response Report', marginX, 44);

    document.setFont('helvetica', 'normal');
    document.setFontSize(11);
    document.text('Command Center - Production Support', marginX, 65);
    document.text(`Generated: ${now.toLocaleString()}`, marginX, 82);

    const severityColor = severityColorMap[record.severity];
    const badgeWidth = 82;
    const badgeHeight = 24;
    const badgeX = pageWidth - marginX - badgeWidth;
    const badgeY = 28;
    document.setFillColor(severityColor[0], severityColor[1], severityColor[2]);
    document.roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 12, 12, 'F');
    document.setTextColor(255, 255, 255);
    document.setFont('helvetica', 'bold');
    document.setFontSize(10);
    document.text(record.severity, badgeX + 27, badgeY + 16);

    yPosition = 128;

    document.setTextColor(30, 41, 59);
    document.setFont('helvetica', 'bold');
    document.setFontSize(14);
    document.text('Incident Snapshot', marginX, yPosition);
    yPosition += 12;

    const drawMetaRow = (labelLeft: string, valueLeft: string, labelRight: string, valueRight: string) => {
      ensureSpace(48);
      const rowY = yPosition + 12;

      document.setFillColor(255, 255, 255);
      document.setDrawColor(226, 232, 240);
      document.roundedRect(marginX, rowY - 12, 252, 36, 8, 8, 'FD');
      document.roundedRect(marginX + 270, rowY - 12, 252, 36, 8, 8, 'FD');

      document.setTextColor(100, 116, 139);
      document.setFont('helvetica', 'bold');
      document.setFontSize(9);
      document.text(labelLeft, marginX + 10, rowY + 2);
      document.text(labelRight, marginX + 280, rowY + 2);

      document.setTextColor(15, 23, 42);
      document.setFont('helvetica', 'normal');
      document.setFontSize(11);
      document.text(valueLeft, marginX + 10, rowY + 17);
      document.text(valueRight, marginX + 280, rowY + 17);

      yPosition += 44;
    };

    drawMetaRow('Incident ID', record.id, 'Platform', record.platform);
    drawMetaRow('Status', record.status, 'Tier', record.tier);
    drawMetaRow('Opened', record.opened, 'Resolved At', record.resolvedAt ?? 'N/A');
    drawMetaRow('Resolved Minutes', record.resolvedMins === null ? 'N/A' : `${record.resolvedMins} min`, 'Severity', record.severity);

    const drawSection = (title: string, content: string) => {
      const wrapped = document.splitTextToSize(content, 500) as string[];
      const sectionHeight = Math.max(48, wrapped.length * 14 + 28);
      ensureSpace(sectionHeight + 20);

      const sectionTop = yPosition + 6;
      document.setFillColor(255, 255, 255);
      document.setDrawColor(226, 232, 240);
      document.roundedRect(marginX, sectionTop, 523, sectionHeight, 10, 10, 'FD');

      document.setTextColor(30, 74, 107);
      document.setFont('helvetica', 'bold');
      document.setFontSize(11);
      document.text(title, marginX + 12, sectionTop + 18);

      document.setTextColor(30, 41, 59);
      document.setFont('helvetica', 'normal');
      document.setFontSize(10);
      document.text(wrapped, marginX + 12, sectionTop + 36);

      yPosition += sectionHeight + 14;
    };

    drawSection('Description', record.error);
    drawSection('Solution', safeSolution);
    drawSection('Tags', tagsText);

    const footerY = pageHeight - 24;
    document.setDrawColor(203, 213, 225);
    document.line(marginX, footerY - 12, pageWidth - marginX, footerY - 12);
    document.setTextColor(100, 116, 139);
    document.setFont('helvetica', 'normal');
    document.setFontSize(9);
    document.text('Command Center Incident Export', marginX, footerY);
    document.text(`Ref: ${record.id}`, pageWidth - marginX - 56, footerY);

    document.save(fileName);
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  private showExportNotification(message: string): void {
    this.exportNotification.set(message);

    if (this.exportNotificationTimeoutId) {
      window.clearTimeout(this.exportNotificationTimeoutId);
    }

    this.exportNotificationTimeoutId = window.setTimeout(() => {
      this.exportNotification.set('');
    }, 3000);
  }

  private triggerDownload(fileName: string, data: string, mimeType: string): void {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  private scoreHistoryEntry(
    entry: {
      id: string;
      platform: string;
      severity: string;
      tier: string;
      status: string;
      error: string;
      solution: string;
      tags: string[];
    },
    tokens: string[]
  ): number {
    const fields = [
      entry.id,
      entry.platform,
      entry.severity,
      entry.tier,
      entry.status,
      entry.error,
      entry.solution
    ]
      .join(' ')
      .toLowerCase();

    let score = 0;

    for (const token of tokens) {
      if (entry.tags.some((tag) => tag.toLowerCase().includes(token))) {
        score += 6;
      }

      if (entry.solution.toLowerCase().includes(token)) {
        score += 4;
      }

      if (entry.error.toLowerCase().includes(token)) {
        score += 3;
      }

      if (fields.includes(token)) {
        score += 1;
      }
    }

    return score;
  }
}
