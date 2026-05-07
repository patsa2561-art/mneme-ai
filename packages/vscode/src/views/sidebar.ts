/**
 * Sidebar tree view — the vscode-facing wrapper around the pure
 * `buildItems` formatter in sidebarProvider.ts.
 *
 * Lifecycle:
 *   1. Activation registers the empty tree.
 *   2. We populate lazily — first on activation, then on
 *      `mneme.refresh` or document save.
 *   3. Each node maps onto the right `vscode.TreeItem` flavour:
 *        - section nodes use ThemeIcon('symbol-namespace')
 *        - at-risk file nodes open the file on click
 *        - passport summary opens the nervous-system webview
 */

import * as vscode from "vscode";
import { buildItems, type SidebarReportData, type TreeItemModel } from "./sidebarProvider.js";

export class MnemeSidebar implements vscode.TreeDataProvider<TreeItemModel> {
  private readonly emitter = new vscode.EventEmitter<TreeItemModel | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private current: TreeItemModel[] = [];

  setData(data: SidebarReportData): void {
    this.current = buildItems(data);
    this.emitter.fire(undefined);
  }

  getChildren(element?: TreeItemModel): TreeItemModel[] {
    if (!element) return this.current;
    return element.children ?? [];
  }

  getTreeItem(element: TreeItemModel): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.collapsibleState === "expanded"
        ? vscode.TreeItemCollapsibleState.Expanded
        : element.collapsibleState === "collapsed"
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
    );
    if (element.description) item.description = element.description;
    if (element.tooltip) item.tooltip = new vscode.MarkdownString(element.tooltip);

    switch (element.kind) {
      case "section":
        item.iconPath = new vscode.ThemeIcon("symbol-namespace");
        break;
      case "audit-status":
        item.iconPath = new vscode.ThemeIcon("verified");
        break;
      case "audit-empty":
        item.iconPath = new vscode.ThemeIcon("info");
        break;
      case "atrophy-file":
        item.iconPath = new vscode.ThemeIcon("warning");
        item.resourceUri = element.fileToOpen
          ? vscode.Uri.file(element.fileToOpen)
          : undefined;
        break;
      case "atrophy-empty":
        item.iconPath = new vscode.ThemeIcon("check");
        break;
      case "passport-summary":
        item.iconPath = new vscode.ThemeIcon("person");
        break;
      case "passport-file":
        item.iconPath = new vscode.ThemeIcon("file");
        item.resourceUri = element.fileToOpen
          ? vscode.Uri.file(element.fileToOpen)
          : undefined;
        break;
      case "passport-empty":
      case "no-db":
      case "info":
        item.iconPath = new vscode.ThemeIcon("info");
        break;
    }

    if (element.fileToOpen) {
      item.command = {
        command: "vscode.open",
        title: "Open file",
        arguments: [vscode.Uri.file(element.fileToOpen)],
      };
    } else if (element.commandId) {
      item.command = {
        command: element.commandId,
        title: element.label,
      };
    }

    return item;
  }
}
