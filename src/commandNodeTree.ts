import * as vscode from 'vscode';

export class VisualGDBNodeProvider implements vscode.TreeDataProvider<VisualGDBCommandNode> {

	private _onDidChangeTreeData: vscode.EventEmitter<VisualGDBCommandNode | undefined | void> = new vscode.EventEmitter<VisualGDBCommandNode | undefined | void>();
	readonly onDidChangeTreeData: vscode.Event<VisualGDBCommandNode | undefined | void> = this._onDidChangeTreeData.event;

	constructor(private readonly context: vscode.ExtensionContext) { }

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: VisualGDBCommandNode): vscode.TreeItem {
		return element;
	}

	getChildren(element?: VisualGDBCommandNode): Thenable<VisualGDBCommandNode[]> {
		if (element)
			return Promise.resolve([]);
		return Promise.resolve([
			new VisualGDBCommandNode('Open Workspace in VisualGDB', 'visualgdb.openWorkspaceInVisualGDB'),
			//new VisualGDBCommandNode('Analyze CMake Setup', 'visualgdb.analyzeCMake'),
		]);
	}
}

export class VisualGDBCommandNode extends vscode.TreeItem {	

	constructor(public readonly label: string, public readonly commandId: string) {
		super(label, vscode.TreeItemCollapsibleState.None);
		this.command = {
			command: commandId,
			title: label,
			arguments: [this]
		};
	}

	contextValue = 'visualgdbCommandNode';
}