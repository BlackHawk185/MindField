const fs = require('fs')
const path = require('path')
const vscode = require('vscode')

const graphFolder = '.mindfield'
const graphFile = 'mindfield.graph.json'

function activate(context) {
  const command = vscode.commands.registerCommand('mindfield.open', () => openMindfield(context))
  context.subscriptions.push(command)
}

function openMindfield(context) {
  const panel = vscode.window.createWebviewPanel('mindfield', 'Mindfield', vscode.ViewColumn.Beside, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.file(path.join(context.extensionPath, 'dist'))],
  })
  panel.webview.html = getHtml(context, panel.webview)
  panel.webview.onDidReceiveMessage(async (message) => {
    if (message.type === 'mindfield.request-document') panel.webview.postMessage({ type: 'mindfield.document', document: await readGraph(context) })
    if (message.type === 'mindfield.save-document') await writeGraph(message.document)
  }, undefined, context.subscriptions)
}

async function readGraph(context) {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspace) return readSeed(context)
  const projectPath = path.join(workspace, graphFolder, graphFile)
  if (fs.existsSync(projectPath)) return JSON.parse(await fs.promises.readFile(projectPath, 'utf8'))
  return readSeed(context)
}

async function readSeed(context) {
  const seedPath = path.join(context.extensionPath, graphFile)
  if (!fs.existsSync(seedPath)) return null
  return JSON.parse(await fs.promises.readFile(seedPath, 'utf8'))
}

async function writeGraph(document) {
  const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
  if (!workspace || !document) return
  const folder = path.join(workspace, graphFolder)
  await fs.promises.mkdir(folder, { recursive: true })
  await fs.promises.writeFile(path.join(folder, graphFile), `${JSON.stringify(document, null, 2)}\n`, 'utf8')
}

function getHtml(context, webview) {
  const distPath = path.join(context.extensionPath, 'dist')
  const indexPath = path.join(distPath, 'index.html')
  let html = fs.readFileSync(indexPath, 'utf8')
  html = html.replace(/(src|href)="\.\/assets\/([^"]+)"/g, (_match, attribute, asset) => `${attribute}="${webview.asWebviewUri(vscode.Uri.file(path.join(distPath, 'assets', asset)))}"`)
  const nonce = `${Date.now()}${Math.random().toString(36).slice(2)}`
  return html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} https: data:; style-src ${webview.cspSource} 'unsafe-inline' https://fonts.googleapis.com; font-src ${webview.cspSource} https://fonts.gstatic.com; script-src 'nonce-${nonce}'; connect-src ${webview.cspSource};">`).replace(/<script type="module"/g, `<script nonce="${nonce}" type="module"`)
}

function deactivate() {}
module.exports = { activate, deactivate }
