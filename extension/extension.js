import fs from 'node:fs'
import path from 'node:path'
import * as vscode from 'vscode'
import { createSpaceMouseBridge } from './spacemouse.js'

const graphFolder = '.mindfield'
const graphFile = 'mindfield.graph.json'
let output

export function activate(context) {
  output = vscode.window.createOutputChannel('Mindfield')
  context.subscriptions.push(output)
  output.appendLine(`[${new Date().toISOString()}] extension activated`)
  context.subscriptions.push(
    vscode.commands.registerCommand('mindfield.open', async () => {
      output.show(true)
      try {
        await openMindfield(context, await ensureDefaultGraph(context))
      } catch (error) {
        const message = error instanceof Error ? error.stack ?? error.message : String(error)
        output.appendLine(`[${new Date().toISOString()}] launch error: ${message}`)
        void vscode.window.showErrorMessage(`Mindfield could not open: ${message}`)
      }
    }),
    vscode.commands.registerCommand('mindfield.openFile', async () => {
      const selected = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Open Mindfield graph', filters: { 'Mindfield graph': ['json'], 'All files': ['*'] } })
      if (selected?.[0]) await openMindfield(context, selected[0].fsPath)
    }),
    vscode.commands.registerCommand('mindfield.openDevTools', async () => {
      await vscode.commands.executeCommand('workbench.action.webview.openDeveloperTools')
    }),
  )
}

async function openMindfield(context, graphPath) {
  output?.appendLine(`[${new Date().toISOString()}] opening graph: ${graphPath}`)
  const spaceMouse = createSpaceMouseBridge((message) => output?.appendLine(`[${new Date().toISOString()}] ${message}`))
  const panel = vscode.window.createWebviewPanel('mindfield', 'Mindfield', vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'dist'))],
  })
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === 'mindfield.diagnostic') output?.appendLine(`[${new Date().toISOString()}] ${message.message}`)
    try {
      if (message.type === 'mindfield.request-document') panel.webview.postMessage({ type: 'mindfield.document', document: await readGraph(graphPath) ?? await readSeed(context) })
      if (message.type === 'mindfield.save-document') await writeGraph(graphPath, message.document)
      if (message.type === 'mindfield.spacemouse-start') {
        const result = spaceMouse.start((payload) => panel.webview.postMessage(payload))
        panel.webview.postMessage({ type: 'mindfield.spacemouse-status', ...result })
      }
      if (message.type === 'mindfield.spacemouse-stop') spaceMouse.stop()
    } catch (error) {
      output?.appendLine(`[${new Date().toISOString()}] host error: ${error instanceof Error ? error.stack : String(error)}`)
    }
  }, undefined, context.subscriptions)
  panel.onDidDispose(() => spaceMouse.stop(), undefined, context.subscriptions)
  panel.webview.html = getHtml(context, panel.webview)
}

async function ensureDefaultGraph(context) {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspace) return path.join(context.extensionPath, graphFile)
  const folder = path.join(workspace, graphFolder)
  const graphPath = path.join(folder, graphFile)
  if (!fs.existsSync(graphPath)) await writeGraph(graphPath, await readSeed(context))
  return graphPath
}

async function readGraph(graphPath) {
  if (!graphPath || !fs.existsSync(graphPath)) return null
  return JSON.parse(await fs.promises.readFile(graphPath, 'utf8'))
}

async function readSeed(context) {
  const seedPath = path.join(context.extensionPath, graphFile)
  if (!fs.existsSync(seedPath)) return null
  return JSON.parse(await fs.promises.readFile(seedPath, 'utf8'))
}

async function writeGraph(graphPath, document) {
  if (!graphPath || !document) return
  await fs.promises.mkdir(path.dirname(graphPath), { recursive: true })
  await fs.promises.writeFile(graphPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

function getHtml(context, webview) {
  const distPath = path.join(context.extensionPath, 'dist')
  const indexPath = path.join(distPath, 'index.html')
  if (!fs.existsSync(indexPath)) throw new Error(`Mindfield webview asset is missing: ${indexPath}`)
  let html = fs.readFileSync(indexPath, 'utf8')
  html = html.replace(/(src|href)="\.\/assets\/([^"]+)"/g, (_match, attribute, asset) => `${attribute}="${webview.asWebviewUri(vscode.Uri.file(path.join(distPath, 'assets', asset)))}"`)
  const nonce = `${Date.now()}${Math.random().toString(36).slice(2)}`
  return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src ${webview.cspSource} https://fonts.gstatic.com; script-src ${webview.cspSource} 'nonce-${nonce}'; worker-src ${webview.cspSource} blob: data:; child-src ${webview.cspSource} blob: data:; connect-src ${webview.cspSource} https:;">`).replace('<div id="root"></div>', '<div id="root"><div id="mindfield-loader" style="padding:24px;color:#c5d2ee;font:12px sans-serif">Loading Mindfield...</div></div>').replace('</body>', `<script nonce="${nonce}">window.setTimeout(() => { const loader = document.getElementById('mindfield-loader'); if (loader) loader.textContent = 'Mindfield UI failed to start. Open Webview Developer Tools for the console error.' }, 4000)</script></body>`).replace(/<script type="module"/g, `<script nonce="${nonce}" type="module"`)
}

export function deactivate() {}
