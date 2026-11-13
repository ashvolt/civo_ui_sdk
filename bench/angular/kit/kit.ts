/**
 * The kit drawn by Angular (plan D2, T-430), as an A2UI catalog component
 * (T-432). One recursive template walks the kit's markup as data: a case per
 * tag the templates use, so Angular creates each element (SVG ones with the
 * `svg:` prefix, in the SVG namespace) and diffs them on each update; text as
 * text; and at the template's children slot, A2UI's own child hosts. A tag
 * without a case is drawn as `<span data-kit-unknown>`, which the structural gate
 * reports. Generated cases: keep them in step with the kit's tags.
 */
import { NgTemplateOutlet } from "@angular/common";
import { Component, computed, Directive, effect, ElementRef, inject, input, SecurityContext } from "@angular/core";
import { DomSanitizer } from "@angular/platform-browser";
import { A2uiRendererService, CatalogComponent, ComponentHostComponent } from "@a2ui/angular";
import { CHILDREN, type VNode } from "relax-ui-theme-base";
import { kitProps } from "../../src/kit/a2ui.ts";
import { allTemplates } from "../../src/kit/react.ts";

/** URL attributes pass Angular's sanitizer, as an `[attr.href]` binding would. */
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction"]);

/** Sets an element's attributes to exactly `kitAttrs`, removing ones no longer given. */
@Directive({ selector: "[kitAttrs]" })
export class KitAttrs {
  readonly kitAttrs = input.required<Record<string, string>>();
  private readonly element = inject<ElementRef<Element>>(ElementRef).nativeElement;
  private readonly sanitizer = inject(DomSanitizer);
  private names: string[] = [];
  constructor() {
    effect(() => {
      const attrs = this.kitAttrs();
      for (const name of this.names) if (!(name in attrs)) this.element.removeAttribute(name);
      for (const [name, raw] of Object.entries(attrs)) {
        const value = URL_ATTRS.has(name) ? (this.sanitizer.sanitize(SecurityContext.URL, raw) ?? "") : raw;
        if (this.element.getAttribute(name) !== value) this.element.setAttribute(name, value);
      }
      this.names = Object.keys(attrs);
    });
  }
}

@Component({
  selector: "kit-ng-component",
  imports: [NgTemplateOutlet, KitAttrs, ComponentHostComponent],
  template: `
    @if (tree(); as t) {<ng-container *ngTemplateOutlet="node; context: { $implicit: t }" />}
    <ng-template #node let-n>
      @switch (n.tag) {
      @case ('div') {<div [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></div>}
      @case ('p') {<p [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></p>}
      @case ('span') {<span [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></span>}
      @case ('section') {<section [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></section>}
      @case ('aside') {<aside [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></aside>}
      @case ('a') {<a [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></a>}
      @case ('ul') {<ul [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></ul>}
      @case ('ol') {<ol [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></ol>}
      @case ('li') {<li [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></li>}
      @case ('table') {<table [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></table>}
      @case ('caption') {<caption [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></caption>}
      @case ('thead') {<thead [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></thead>}
      @case ('tbody') {<tbody [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></tbody>}
      @case ('tfoot') {<tfoot [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></tfoot>}
      @case ('tr') {<tr [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></tr>}
      @case ('th') {<th [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></th>}
      @case ('td') {<td [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></td>}
      @case ('figure') {<figure [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></figure>}
      @case ('figcaption') {<figcaption [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></figcaption>}
      @case ('h1') {<h1 [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></h1>}
      @case ('h2') {<h2 [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></h2>}
      @case ('h3') {<h3 [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></h3>}
      @case ('h4') {<h4 [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></h4>}
      @case ('h5') {<h5 [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></h5>}
      @case ('h6') {<h6 [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></h6>}
      @case ('strong') {<strong [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></strong>}
      @case ('em') {<em [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></em>}
      @case ('small') {<small [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></small>}
      @case ('b') {<b [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></b>}
      @case ('i') {<i [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></i>}
      @case ('dl') {<dl [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></dl>}
      @case ('dt') {<dt [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></dt>}
      @case ('dd') {<dd [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></dd>}
      @case ('header') {<header [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></header>}
      @case ('footer') {<footer [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></footer>}
      @case ('nav') {<nav [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></nav>}
      @case ('article') {<article [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></article>}
      @case ('svg') {<svg:svg [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></svg:svg>}
      @case ('g') {<svg:g [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></svg:g>}
      @case ('line') {<svg:line [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></svg:line>}
      @case ('rect') {<svg:rect [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></svg:rect>}
      @case ('text') {<svg:text [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></svg:text>}
      @case ('circle') {<svg:circle [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></svg:circle>}
      @case ('polyline') {<svg:polyline [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></svg:polyline>}
      @case ('path') {<svg:path [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></svg:path>}
      @case ('title') {<svg:title [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></svg:title>}
      @case ('desc') {<svg:desc [kitAttrs]="n.attrs"><ng-container *ngTemplateOutlet="kids; context: { $implicit: n.children }" /></svg:desc>}
      @default {<span data-kit-unknown [attr.data-tag]="n.tag"></span>}
      }
    </ng-template>
    <ng-template #kids let-list>
      @for (c of list; track $index) {
        @if (c === slot) {
          @for (child of children(); track child.basePath + '/' + child.id) {<a2ui-v09-component-host [componentKey]="child" [surfaceId]="surfaceId()" />}
        } @else if (isText(c)) {<ng-container>{{ c }}</ng-container>} @else {<ng-container *ngTemplateOutlet="node; context: { $implicit: c }" />}
      }
    </ng-template>
  `,
})
export class KitComponent extends CatalogComponent<never> {
  protected readonly slot = CHILDREN;
  private readonly renderer = inject(A2uiRendererService);
  /** This component's type, from its surface: one class draws every kit component. */
  private readonly type = computed(
    () => this.renderer.surfaceGroup?.getSurface(this.surfaceId())?.componentsModel.get(this.componentId())?.type,
  );
  protected readonly children = computed(() => ((this.props() as Record<string, { value(): unknown }>)["children"]?.value() ?? []) as { id: string; basePath: string }[]);
  protected readonly tree = computed<VNode | undefined>(() => {
    const type = this.type();
    const template = type ? allTemplates[type] : undefined;
    if (!template) return undefined;
    const bound = this.props() as Record<string, { value(): unknown }>;
    const values: Record<string, unknown> = {};
    for (const [k, p] of Object.entries(bound)) values[k] = p?.value();
    return template(kitProps(values) as never);
  });
  protected isText(c: unknown): c is string {
    return typeof c === "string";
  }
}
