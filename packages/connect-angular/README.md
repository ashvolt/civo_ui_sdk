# relax-ui-connect-angular

Render `<gen-ui>` documents with Angular components, such as Angular Material,
PrimeNG or your own. `@angular/core` is the only peer.

```ts
import { Component, EnvironmentInjector, Input, inject } from "@angular/core";
import { MatCardModule } from "@angular/material/card";
import { angularConnector } from "relax-ui-connect-angular";

@Component({
  selector: "gen-mat-card",
  imports: [MatCardModule],
  template: `<mat-card role="region" [attr.aria-label]="title">
    <mat-card-header><mat-card-title>{{ title }}</mat-card-title></mat-card-header>
    <mat-card-content><ng-content /></mat-card-content>
  </mat-card>`,
})
export class GenMatCard {
  @Input() title?: string;
}

el.setAttribute("mode", "light");
el.connectors = [
  angularConnector({ name: "angular-material", injector: inject(EnvironmentInjector), implementations: { Card: GenMatCard } }),
];
```

- A component's inputs are the node's **validated** props. Only the inputs it
  declares are set, and a prop that disappears is cleared.
- The renderer's children are projected into the component's `<ng-content>`.
- Components are created in your application's injector and attached to it,
  so they see its providers and its change detection.
- Compile ahead of time, as an Angular CLI build does. The page then carries no
  compiler, and `script-src 'self'` holds. Angular's runtime component styles
  need a nonce (`ngCspNonce`), not `unsafe-inline`.

A working Angular Material sample, with an AOT app under a strict policy, is
in [examples/angular-host](../../examples/angular-host).
