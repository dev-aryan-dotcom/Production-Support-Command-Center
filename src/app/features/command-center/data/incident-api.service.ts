import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { IncidentRecord, SlaSnapshotRecord, SlaTargetRecord } from './command-center.models';
import { environment } from '../../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class IncidentApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = `${environment.apiBaseUrl}/incidents`;
  private readonly slaTargetsUrl = `${environment.apiBaseUrl}/slaTargets`;
  private readonly slaSnapshotsUrl = `${environment.apiBaseUrl}/slaSnapshots`;

  getIncidents(): Observable<IncidentRecord[]> {
    return this.http.get<IncidentRecord[]>(this.baseUrl);
  }

  createIncident(incident: Omit<IncidentRecord, 'id'>): Observable<IncidentRecord> {
    return this.http.post<IncidentRecord>(this.baseUrl, incident);
  }

  updateIncident(id: string, incident: IncidentRecord): Observable<IncidentRecord> {
    return this.http.put<IncidentRecord>(`${this.baseUrl}/${id}`, incident);
  }

  deleteIncident(id: string): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/${id}`);
  }

  getSlaTargets(): Observable<SlaTargetRecord[]> {
    return this.http.get<SlaTargetRecord[]>(this.slaTargetsUrl);
  }

  upsertSlaTarget(target: SlaTargetRecord): Observable<SlaTargetRecord> {
    return this.http.put<SlaTargetRecord>(`${this.slaTargetsUrl}/${target.id}`, target);
  }

  getSlaSnapshots(): Observable<SlaSnapshotRecord[]> {
    return this.http.get<SlaSnapshotRecord[]>(this.slaSnapshotsUrl);
  }

  upsertSlaSnapshot(snapshot: SlaSnapshotRecord): Observable<SlaSnapshotRecord> {
    return this.http.put<SlaSnapshotRecord>(`${this.slaSnapshotsUrl}/${snapshot.id}`, snapshot);
  }
}
