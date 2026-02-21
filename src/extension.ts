import * as vscode from "vscode";
import * as jsonc from "jsonc-parser";
import * as yaml from "yaml";

/**
 * CodeLens Provider that shows property path above the first line
 */
class PropertyPathCodeLensProvider implements vscode.CodeLensProvider {
  public _onDidChangeCodeLenses: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  public readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  private currentPath: string = "";

  public async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    if (!this.isSupportedLanguage(document.languageId)) {
      this.currentPath = "";
      return [];
    }

    // Update the path based on the current cursor position
    await this.updatePath(document);

    if (this.currentPath) {
      // NEW: Position CodeLens directly ABOVE the cursor line [1]
      const editor = vscode.window.activeTextEditor;
      if (editor && editor.document === document) {
        const position = editor.selection.active;
        const lineAboveCursor = position.line > 0 ? position.line : 0;
        const cursorRange = new vscode.Range(lineAboveCursor, 0, lineAboveCursor, 0);

        return [
          new vscode.CodeLens(cursorRange, {
            title: `${this.currentPath} $(clippy)`,
            tooltip: `Click to copy path: ${this.currentPath}`,
            command: "propertyPathViewer.copy",
            arguments: [this.currentPath],
          }),
        ];
      }
    }
    return [];
  }

  private async updatePath(document: vscode.TextDocument): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document !== document) {
      this.currentPath = "";
      return;
    }

    const position = editor.selection.active;
    const offset = document.offsetAt(position);

    try {
      if (document.languageId === "json" || document.languageId === "jsonc") {
        const location = jsonc.getLocation(document.getText(), offset);
        
        //console.log("Position:", position, "Offset:", offset, "Location:", location);
        
        this.currentPath = location.path
          .map((seg) => (typeof seg === "number" ? `[${seg}]` : seg))
          .join(".");
      } else if (document.languageId === "yaml" || document.languageId === "yml") {
        this.currentPath = this.getYamlPath(document, position);
      }
    } catch (error) {
      console.error("Path detection error:", error);
      this.currentPath = "";
    }
  }

  private isSupportedLanguage(langId: string): boolean {
    console.log("Checking language:", langId);
    return ["json", "jsonc", "yaml", "yml"].includes(langId); // Added "yml"
  }

  /**
   * Gets the YAML property path at the given VS Code Position using the yaml library.
   * Handles multi-document YAML files (separated by ---).
   */
  private getYamlPath(document: vscode.TextDocument, position: vscode.Position): string {
    const content = document.getText();
    const offset = document.offsetAt(position);

    try {
      // FIX: Parse ALL documents in the file
      const docs = yaml.parseAllDocuments(content);

      // Find which document contains the cursor position
      for (const doc of docs) {
        const node = doc.contents as yaml.Node;
        if (node?.range && offset >= node.range[0] && offset <= node.range[1]) {
          // Found the correct document - extract path from it
          const path = this.findPathAtOffset(node, offset);

          // Convert to dot-notation string
          let pathStr = "";
          path.forEach((segment, index) => {
            if (typeof segment === "number") {
              pathStr += `[${segment}]`;
            } else {
              pathStr += (index === 0 ? "" : ".") + segment;
            }
          });
          return pathStr;
        }
      }

      return ""; // Cursor not in any YAML document
    } catch (error) {
      console.error("YAML parsing error:", error);
      return "";
    }
  }

  /**
   * Recursively finds the property path to the node containing the given character offset.
   */
  private findPathAtOffset(node: yaml.Node | null, offset: number): (string | number)[] {
    if (!node) return [];

    if (yaml.isMap(node)) {
      for (const pair of node.items) {
        // Check if cursor is in the key or value of a pair
        const keyNode = pair.key as any;
        const valueNode = pair.value as any;

        if (keyNode?.range && offset >= keyNode.range[0] && offset <= keyNode.range[1]) {
          return [keyNode.value];
        }
        if (valueNode?.range && offset >= valueNode.range[0] && offset <= valueNode.range[1]) {
          const path = this.findPathAtOffset(valueNode, offset);
          return [keyNode.value, ...path];
        }
      }
    } else if (yaml.isSeq(node)) {
      for (let i = 0; i < node.items.length; i++) {
        const item = node.items[i] as any;
        if (item?.range && offset >= item.range[0] && offset <= item.range[1]) {
          const path = this.findPathAtOffset(item, offset);
          return [i, ...path];
        }
      }
    }

    return [];
  }
}

export function activate(context: vscode.ExtensionContext) {
  console.log("🔥 json+yaml+paths - Property Path Viewer plugin ACTIVATED");

  const provider = new PropertyPathCodeLensProvider();

  // Register the provider for all supported languages
  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ pattern: "**/*.{json,jsonc,yaml,yml}" }, provider),
  );

  // Trigger a refresh whenever the cursor moves (with debounce)
  let timeout: NodeJS.Timeout;
  context.subscriptions.push(
    vscode.window.onDidChangeTextEditorSelection(() => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        provider._onDidChangeCodeLenses.fire();
      }, 50); // 50ms delay
    }),
  );

  // Register the copy command
  const copyCommand = vscode.commands.registerCommand("propertyPathViewer.copy", (path: string) => {
    if (path) {
      vscode.env.clipboard.writeText(path).then(() => {
        vscode.window.showInformationMessage(`📋 Copied: ${path}`);
      });
    }
  });

  context.subscriptions.push(copyCommand);
}

export function deactivate() {}
