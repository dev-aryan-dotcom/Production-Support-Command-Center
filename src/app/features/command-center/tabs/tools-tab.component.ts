import { ChangeDetectionStrategy, Component } from '@angular/core';

interface ToolItem {
  icon: string;
  label: string;
}

@Component({
  selector: 'app-tools-tab',
  templateUrl: './tools-tab.component.html',
  styleUrl: './tools-tab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ToolsTabComponent {
  readonly tools: ToolItem[] = [
    { icon: 'fa-databricks', label: 'Databricks' },
    { icon: 'fa-chart-line', label: 'Dynatrace' },
    { icon: 'fa-bell', label: 'PagerDuty' },
    { icon: 'fa-tasks', label: 'JIRA/ServiceNow' },
    { icon: 'fa-slack', label: 'Slack' },
    { icon: 'fa-rocket', label: 'Airflow' },
    { icon: 'fa-stream', label: 'Kafka' },
    { icon: 'fa-database', label: 'Delta Lake' },
    { icon: 'fa-code-branch', label: 'dbt' },
    { icon: 'fa-aws', label: 'AWS/Azure' },
    { icon: 'fa-github', label: 'GitHub' },
    { icon: 'fa-chart-simple', label: 'Grafana' },
    { icon: 'fa-lock', label: 'Vault' },
    { icon: 'fa-book', label: 'Confluence' }
  ];
}
