import * as vscode from 'vscode';

export class DepNodeProvider implements vscode.TreeDataProvider<Dependency> {

	private _onDidChangeTreeData: vscode.EventEmitter<Dependency | undefined | void> = new vscode.EventEmitter<Dependency | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<Dependency | undefined | void> = this._onDidChangeTreeData.event;

	constructor(private readonly context: vscode.ExtensionContext) { }

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: Dependency): vscode.TreeItem {
		return element;
	}

	getChildren(element?: Dependency): Thenable<Dependency[]> {
		if (element)
			return Promise.resolve([]);
		return Promise.resolve([new Dependency('Open Workspace in VisualGDB')]);
	}
}

export class Dependency extends vscode.TreeItem {

	constructor(public readonly label: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.command = {
			command: 'visualgdb.openWorkspaceInVisualGDB',
			title: 'Open Workspace in VisualGDB',
			arguments: [this]
		};
	}

	contextValue = 'dependency';
}