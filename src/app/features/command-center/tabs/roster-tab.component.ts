import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommandCenterStore } from '../data/command-center.store';

@Component({
  selector: 'app-roster-tab',
  templateUrl: './roster-tab.component.html',
  styleUrl: './roster-tab.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class RosterTabComponent {
  private readonly store = inject(CommandCenterStore);

  readonly rosterDays = this.store.rosterDays;
  readonly rosterRows = this.store.rosterRows;
  readonly todayRosterIndex = this.store.todayRosterIndex;
}
