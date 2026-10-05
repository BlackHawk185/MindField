# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:


## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
 # Mindfield
 
 Mindfield is a 3D editor for building AI-readable thought networks.
 
## Open In VS Code
 
The project includes a VS Code webview host. Package and install it once:

```text
npm run install:extension
```

After that, use Mindfield from any already-open VS Code project. Open the Command Palette and run `Mindfield: Open Graph`. If the project does not have a graph yet, Mindfield automatically creates:
 
 ```text
 .mindfield/mindfield.graph.json
 ```

To work with a different graph file, run `Mindfield: Open Graph File` and choose any JSON graph.
 
For extension development instead:
 
 1. Open this project in VS Code.
 2. Press `F5` and choose `Run Mindfield Extension`.
 3. In the Extension Development Host, run `Mindfield: Open Graph` from the Command Palette.
 
There is no Vite server or port involved in normal use. The extension serves the built frontend inside a VS Code panel and saves graph edits back to the workspace file.
 
 ## Standalone Browser
 
 `npm run dev` remains available for browser development. In that mode, edits use browser local storage and can be exported as `mindfield.graph.json`.
 
 ## Checks
 
 ```text
 npm run build
 npm run lint
 ```
