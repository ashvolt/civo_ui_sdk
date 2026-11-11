/** The renderers with a page, and the packages they exercise. */
export const RENDERERS: Record<string, { page: string; packages: Record<string, string>; ladders?: false }> = {
  "ours-element": { page: "ours-element.html", packages: { "relax-ui-element": "workspace" } },
  "ours-react": { page: "ours-react.html", packages: { "relax-ui-react": "workspace", react: "19" } },
  // The element with a React framework connector: soaked, for its mounted
  // components; not laddered, since its markup adds the connector's mount
  // points around each component.
  "ours-connect-react": {
    page: "ours-connect-react.html",
    packages: { "relax-ui-element": "workspace", "relax-ui-connect-react": "workspace", react: "19" },
    ladders: false,
  },
};
