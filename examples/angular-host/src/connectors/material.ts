/**
 * A sample Angular Material connector (T-252), through
 * `relax-ui-connect-angular`.
 *
 * Five components become Material's own: Card, Metric and Callout as
 * `mat-card`, Badge as `mat-chip`, Table as `mat-table`. The rest are left to
 * the base theme, which the element reports as fallbacks. Each template's root
 * carries the role the contract names for its type.
 *
 * Plain standalone components with `@Input()`s, so they compile ahead of time
 * in the app and just in time in the conformance tests alike. Children arrive
 * through `<ng-content>`.
 */
import { Component, Input, type EnvironmentInjector } from "@angular/core";
import { MatCardModule } from "@angular/material/card";
import { MatChip } from "@angular/material/chips";
import { MatTableModule } from "@angular/material/table";
import { angularConnector } from "relax-ui-connect-angular";
import type { Connector } from "relax-ui-element";

@Component({
  selector: "gen-mat-card",
  imports: [MatCardModule],
  template: `
    <mat-card role="region" [attr.aria-label]="title" appearance="outlined">
      @if (title !== undefined) {
        <mat-card-header>
          <mat-card-title>{{ title }}</mat-card-title>
          @if (subtitle) {
            <mat-card-subtitle>{{ subtitle }}</mat-card-subtitle>
          }
        </mat-card-header>
      }
      <mat-card-content><ng-content /></mat-card-content>
    </mat-card>
  `,
})
export class GenMatCard {
  @Input() title?: string;
  @Input() subtitle?: string;
}

@Component({
  selector: "gen-mat-metric",
  imports: [MatCardModule],
  template: `
    <mat-card role="group" [attr.aria-label]="label" appearance="outlined" class="gen-mat-metric">
      <mat-card-content>
        <p class="gen-mat-metric__label">{{ label }}</p>
        <p class="gen-mat-metric__value">
          {{ value }}
          @if (trend) {
            <span role="img" [attr.aria-label]="'trend ' + trend" [class]="'gen-mat-trend gen-mat-trend--' + trend">{{ glyph[trend] }}</span>
          }
        </p>
        @if (caption !== undefined) {
          <p class="gen-mat-metric__caption">{{ caption }}</p>
        }
      </mat-card-content>
    </mat-card>
  `,
})
export class GenMatMetric {
  @Input() label?: string;
  @Input() value?: string;
  @Input() caption?: string;
  @Input() trend?: "up" | "down" | "flat";
  readonly glyph = { up: "▲", down: "▼", flat: "▬" };
}

@Component({
  selector: "gen-mat-callout",
  imports: [MatCardModule],
  template: `
    <mat-card role="note" appearance="outlined" [class]="'gen-mat-callout gen-mat-callout--' + (tone ?? 'info')">
      <mat-card-content>
        <p class="gen-mat-callout__title">{{ title }}</p>
        <p>{{ body }}</p>
      </mat-card-content>
    </mat-card>
  `,
})
export class GenMatCallout {
  @Input() title?: string;
  @Input() body?: string;
  @Input() tone?: "info" | "success" | "warning" | "danger";
}

@Component({
  selector: "gen-mat-badge",
  imports: [MatChip],
  template: `<mat-chip role="note" disableRipple [class]="'gen-mat-chip gen-mat-chip--' + (tone ?? 'neutral')">{{ text }}</mat-chip>`,
})
export class GenMatBadge {
  @Input() text?: string;
  @Input() tone?: string;
}

@Component({
  selector: "gen-mat-table",
  imports: [MatTableModule],
  template: `
    <table mat-table role="table" [dataSource]="rows ?? []">
      @if (caption !== undefined) {
        <caption>{{ caption }}</caption>
      }
      @for (column of columns ?? []; track $index; let i = $index) {
        <ng-container [matColumnDef]="'c' + i">
          <th mat-header-cell *matHeaderCellDef scope="col">{{ column }}</th>
          <td mat-cell *matCellDef="let row">{{ row[i] ?? "" }}</td>
        </ng-container>
      }
      <tr mat-header-row *matHeaderRowDef="ids()"></tr>
      <tr mat-row *matRowDef="let row; columns: ids()"></tr>
    </table>
  `,
})
export class GenMatTable {
  @Input() columns?: string[];
  @Input() rows?: string[][];
  @Input() caption?: string;
  ids(): string[] {
    return (this.columns ?? []).map((_, i) => `c${i}`);
  }
}

const implementations = {
  Card: GenMatCard,
  Metric: GenMatMetric,
  Callout: GenMatCallout,
  Badge: GenMatBadge,
  Table: GenMatTable,
};

export const MATERIAL_TYPES = Object.keys(implementations);

export function material(injector: EnvironmentInjector): Connector {
  return angularConnector({ name: "angular-material", injector, implementations });
}
