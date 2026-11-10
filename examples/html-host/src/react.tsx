/**
 * The React host for the cross-host comparison (T-256): the same route, the
 * same document, drawn by `relax-ui-react`'s renderer and the same base theme,
 * with no Web Component involved.
 */
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { standardContract } from "relax-ui-contract";
import { baseComponents, createGenerativeRenderer, GenerativeTheme, useGenerativeObject } from "relax-ui-react";

const Renderer = createGenerativeRenderer(standardContract, baseComponents as never);

function App() {
  // The page's own route, same origin: trusted, as `api` always has been.
  const { object, value, error, submit } = useGenerativeObject<{ root: never }>({ api: "/api/ui" });
  useEffect(() => {
    void submit({ label: "route" });
  }, [submit]);
  const status = error ? "error" : value ? "complete" : "streaming";
  return (
    <main>
      <h1>The same document, drawn by relax-ui-react</h1>
      <GenerativeTheme>
        <div id="react-base" data-status={status}>
          <Renderer node={object?.root} />
        </div>
      </GenerativeTheme>
    </main>
  );
}

createRoot(document.getElementById("app")!).render(<App />);
