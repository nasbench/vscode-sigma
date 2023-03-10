import * as vscode from "vscode"
import { attackTags } from "./extension"
const cp = require("child_process")
import { SigmaSearchResultEntry  } from "./types"
import {execQuery, escapeString, cleanField} from "./sse"

export function sigmaCompile(cfg: any, rulepath: string) {
    let configs = ""
    // Check if cfg.config is not array
    if (!Array.isArray(cfg.config)) {
        configs = `--config ${cfg.config}`
    } else {
        for (let entry of cfg.config) {
            configs = `${configs} --config ${entry}`
        }
    }
    let command = `sigmac ${configs} --target ${cfg.target} ${cfg.additionalArgs || ""} ${rulepath}`
    return new Promise<any>((resolve, reject) =>
        cp.exec(command, (err: string, stdout: string, stderr: string) => {
            if (err) {
                reject(`${err} --- ${stderr}`)
            } else {
                vscode.env.clipboard.writeText(stdout).then(nil => {
                    vscode.window.showInformationMessage("Sigma rule copied to clipboard")
                })
                resolve(stdout)
            }
        }),
    )
}
export async function addTagQuickpick() {
    const buildQuickPickItems = (callback: (value: vscode.QuickPickItem[]) => void) => {
        callback(
            attackTags
                .map((tag: any) => {
                    return { label: `${tag["tag"]} - ${tag["name"]}`, detail: `${tag["description"]}` }
                })
                .sort()
                .reverse(),
        )
    }

    const target = await vscode.window.showQuickPick<vscode.QuickPickItem>(
        new Promise<vscode.QuickPickItem[]>(buildQuickPickItems),
        {
            placeHolder: "Registry ...",
            matchOnDescription: true,
            matchOnDetail: true,
        },
    )
    if (target !== undefined && vscode.window.activeTextEditor!.selection) {
        const tagsRegex = new RegExp("^tags:$\n(\\s*-.+\\n)*", "m")
        let docText = vscode.window.activeTextEditor?.document.getText()!
        let tags = tagsRegex.exec(docText)
        let tab = "    "
        if (
            vscode.window.activeTextEditor?.options.tabSize &&
            typeof vscode.window.activeTextEditor?.options.tabSize !== "string"
        ) {
            tab = ` `.repeat(vscode.window.activeTextEditor?.options.tabSize)
        }
        let tagtoadd = target?.label.match("(.+?) -")![1].toLowerCase()
        if (tagtoadd.match(/^ta.*/)) {
            // Use actual name instead
            tagtoadd = target?.label.match(".+ - (.+)")![1].replace(/\s/g, "_").toLocaleLowerCase()
        }
        if (tags) {
            let index = docText.indexOf(tags[0]) + tags[0].length

            let pos = vscode.window.activeTextEditor?.document.positionAt(index)
            vscode.window.activeTextEditor?.edit(textEdit => {
                textEdit.insert(
                    vscode.window.activeTextEditor?.document.positionAt(index)!,
                    `${tab}- attack.${tagtoadd}\n`,
                )
            })
        } else {
            vscode.window.activeTextEditor!.document.lineAt(vscode.window.activeTextEditor!.selection.active.line).range
            vscode.window.activeTextEditor?.edit(textEdit => {
                textEdit.insert(vscode.window.activeTextEditor?.selection.end!, `${tab}- attack.${tagtoadd}`)
            })
        }
    }
}

// Try to expand List

export function onEnterKey(modifiers?: string) {
    let editor = vscode.window.activeTextEditor
    if (!editor) {
        return
    }
    let cursorPos: vscode.Position = editor.selection.active
    let line = editor.document.lineAt(cursorPos.line)
    let textBeforeCursor = line.text.substring(0, cursorPos.character)
    let textAfterCursor = line.text.substring(cursorPos.character)

    let lineBreakPos = cursorPos
    if (modifiers === "ctrl") {
        lineBreakPos = line.range.end
    }

    if (modifiers === "shift") {
        return asNormal("enter", modifiers)
    }

    const lineTextNoSpace = line.text.replace(/\s/g, "")
    if (
        lineTextNoSpace.length > 2 &&
        (lineTextNoSpace.replace(/\-/g, "").length === 0 || lineTextNoSpace.replace(/\*/g, "").length === 0)
    ) {
        return asNormal("enter", modifiers)
    }
    let matches: RegExpExecArray | null
    //// If it's an empty list item, remove it
    if ((matches = /^(\s*)-\s*(''|""|)$/.exec(line.text)) !== null) {
        return editor
            .edit(editBuilder => {
                let listHeader = /:\s*$/.test(editor!.document.lineAt(line.lineNumber - 1).text)
                editBuilder.delete(line.range)
                let tab = editor?.options.tabSize
                if (typeof tab === "number" && !listHeader) {
                    editBuilder.insert(line.range.end, matches![1].substring(0, matches![1].length - tab))
                } else {
                    editBuilder.insert(line.range.end, matches![1].substring(0, matches![1].length))
                }
            })
            .then(() => {
                editor!.revealRange(editor!.selection)
            })
    }

    let sep = false
    if ((matches = /^(\s*-\s*)(.)/.exec(textBeforeCursor)) !== null) {
        // Unordered list
        return editor
            .edit(editBuilder => {
                // when using ' as seperator
                if (matches![2] === "'") {
                    sep = true
                    if (lineBreakPos.isEqual(line.range.end)) {
                        editBuilder.insert(lineBreakPos, `\n${matches![1]}''`)
                    } else {
                        editBuilder.insert(lineBreakPos, `'\n${matches![1]}'`)
                    }
                }
                // When using " as seperator
                else if (matches![2] === '"') {
                    sep = true
                    if (lineBreakPos.isEqual(line.range.end)) {
                        editBuilder.insert(lineBreakPos, `\n${matches![1]}""`)
                    } else {
                        editBuilder.insert(lineBreakPos, `"\n${matches![1]}"`)
                    }
                } else {
                    editBuilder.insert(lineBreakPos, `\n${matches![1]}`)
                }
            })
            .then(() => {
                // Fix cursor position
                console.log(cursorPos.isEqual(lineBreakPos))
                if (modifiers === "ctrl" && !cursorPos.isEqual(lineBreakPos)) {
                    let newCursorPos = cursorPos.with(line.lineNumber + 1, matches![1].length)
                    if (sep === true) {
                        newCursorPos = cursorPos.with(line.lineNumber + 1, matches![1].length + 1)
                    }
                    editor!.selection = new vscode.Selection(newCursorPos, newCursorPos)
                } else if (sep === true) {
                    let newCursorPos = cursorPos.with(line.lineNumber + 1, matches![1].length + 1)
                    editor!.selection = new vscode.Selection(newCursorPos, newCursorPos)
                }
            })
            .then(() => {
                editor!.revealRange(editor!.selection)
            })
    } else if ((matches = /^(\s*).*:\s*$/.exec(textBeforeCursor)) !== null) {
        // Create new Table
        return editor
            .edit(editBuilder => {
                let tab = editor?.options.tabSize
                if (typeof tab === "number") {
                    editBuilder.insert(lineBreakPos, `\n${matches![1]}${" ".repeat(tab)}- `)
                } else {
                    editBuilder.insert(lineBreakPos, `\n${matches![1]}\t- `)
                }
            })
            .then(() => {
                // Fix cursor position
                if (modifiers === "ctrl" && !cursorPos.isEqual(lineBreakPos)) {
                    let newCursorPos = cursorPos.with(line.lineNumber + 1, matches![1].length)
                    editor!.selection = new vscode.Selection(newCursorPos, newCursorPos)
                }
            })
    } else {
        return asNormal("enter", modifiers)
    }
}

function asNormal(key: string, modifiers?: string) {
    switch (key) {
        case "enter":
            if (modifiers === "ctrl") {
                return vscode.commands.executeCommand("editor.action.insertLineAfter")
            } else {
                return vscode.commands.executeCommand("type", { source: "keyboard", text: "\n" })
            }
        case "tab":
            if (modifiers === "shift") {
                return vscode.commands.executeCommand("editor.action.outdentLines")
            } else if (
                vscode.window.activeTextEditor!.selection.isEmpty &&
                vscode.workspace.getConfiguration("emmet").get<boolean>("triggerExpansionOnTab")
            ) {
                return vscode.commands.executeCommand("editor.emmet.action.expandAbbreviation")
            } else {
                return vscode.commands.executeCommand("tab")
            }
        case "backspace":
            return vscode.commands.executeCommand("deleteLeft")
    }
}

export async function related(idx: number) { 
    let document = vscode.window.activeTextEditor?.document
    if (!(document)) {
        return
    }

    let stopDefinition = new RegExp('^[a-z].*', "i")
    let idDefinition = new RegExp('^\\s*-\\sid:\\s([0-9a-fA-F]{8}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{4}\\b-[0-9a-fA-F]{12})', "i")
    let cur = idx+1
    let ids = []
    while (true) {
        let line = document.lineAt(cur).text
        const matchs = stopDefinition.exec(line)
        if (matchs) {
            break
        }else{
            const idmatch = idDefinition.exec(line)
            if (idmatch){
                ids.push(idmatch[1])
            }
        }
        cur++
    }

    console.log(ids)

    let result = new Map<string, SigmaSearchResultEntry>();
    for (var id of ids) {
        let results = execQuery("id:\""+id+"\"")
        for (var r of await results) {
            result.set(id, r)
        }
    }

    let webviewPanel = vscode.window.createWebviewPanel("panel", "Sigma Search", vscode.ViewColumn.Beside, {
        enableScripts: true,
    })

    let html = ""
    html = `<html>` + HEAD
    result.forEach(async (rule: SigmaSearchResultEntry, key: string) => {
        html += `<button class="accordion">`
        html += `<div style="float:left">`
        html += `<a href="` + rule.url + `">` + rule.title + `</a>`
        html += `</div>`
        html += `<div style="float:right">` + key + `</div>`

        html += `<br><div style="float:left">` + rule.description + `</div>`
        
        html += `<div style="float:left">File: ` + rule.file + `</div>`
        html += `<br><div style="float:right">Level: ` + rule.level + `</div>`

        html += `</button>`
        html += `<div class="panel">`
        html += "<pre>" + rule.detection + "</pre>"
        html += `</div><br>`
    });

    html += SCRIPT + `</html>`

    webviewPanel.webview.html = html
}

export async function lookup() {
    let sels = vscode.window.activeTextEditor?.selections
    let document = vscode.window.activeTextEditor?.document
    let strings = []
    let indeces = []
    let stringDefinition = new RegExp('[:-]\\s["\'](.+)["\']', "i")
    let fieldDefinition = new RegExp('^\\s*[-\\s]?(.+):', "i")
    if (!(sels && document)) {
        return
    }

    for (var sel of sels) {
        for (let i = sel.start.line; i <= sel.end.line; i++) {
            if (i === sel.end.line && sel.end.character === 0) {
                continue
            }
            let line = document.lineAt(i).text
            if (!line.trim()) {
                continue
            }

            const matchs = stringDefinition.exec(line)
            if (matchs) {
                strings.push(matchs[1])
                indeces.push(i)
            }

        }
    }

    if (strings.length == 0){
        return
    }

    let queryFieldMust = ""
    let queryFieldShould = ""
    let queryFullMust = ""
    let queryFullShould = ""
    let c = 0
    for (var s of strings) {
        s = escapeString(s)
        queryFullMust += '+"' + s + '" '
        queryFullShould += '"' + s + '" '
        let cur = indeces[c]
        while (cur >= 0) {
            let line = document.lineAt(cur).text
            const matchs = fieldDefinition.exec(line)
            if (matchs) {
                queryFieldMust += "+" + cleanField(matchs[1]) + ":\"" + s + "\" "
                queryFieldShould += cleanField(matchs[1]) + ":\"" + s + "\" "
                break
            }
            cur--
        }
        c++
    }

    console.log(queryFieldMust)
    console.log(queryFieldShould)
    console.log(queryFullMust)
    console.log(queryFullShould)

    let queries = [queryFieldMust, queryFieldShould, queryFullMust, queryFullShould]
    let result = new Map<string, SigmaSearchResultEntry>();
    for (var q of queries) {
        let results = execQuery(q)
        for (var r of await results) {
            let tmp = result.get(r.title)
            if (!tmp) {
                result.set(r.title, r)
            } else {
                if (r.score > tmp.score) {
                    result.set(r.title, r)
                }
            }
        }
    }

    let webviewPanel = vscode.window.createWebviewPanel("panel", "Sigma Search", vscode.ViewColumn.Beside, {
        enableScripts: true,
    })

    let html = ""
    html = `<html>` + HEAD
    html += "<pre>Query ~ " + queryFullShould + "</pre>"
    result.forEach(async (rule: SigmaSearchResultEntry, key: string) => {
        html += `<button class="accordion">`
        html += `<div style="float:left">`
        html += `<a href="` + rule.url + `">` + rule.title + `</a>`
        html += `</div>`
        html += `<div style="float:right">Significance: ` + rule.score.toFixed(2) + `</div>`

        html += `<br><div style="float:left">` + rule.description + `</div>`
        
        html += `<div style="float:left">File: ` + rule.file + `</div>`
        html += `<br><div style="float:right">Level: ` + rule.level + `</div>`

        html += `</button>`
        html += `<div class="panel">`
        html += "<pre>" + rule.detection + "</pre>"
        html += `</div><br>`
    });

    html += SCRIPT + `</html>`

    webviewPanel.webview.html = html
}

var HEAD: string = `
<head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
.accordion {
  cursor: pointer;
  padding: 12px;
  width: 100%;
  text-align: left;
  border: none;
  outline: none;
  transition: 0.4s;
  color: white;
  background-color: #32302f;
}

.active, .accordion:hover {
  background-color: #464a43;
}

.panel {
  padding: 0 18px;
  display: none;
  overflow: hidden;
} 

.arrow {
    border: solid grey;
    border-width: 0 3px 3px 0;
    display: inline-block;
    padding: 4px;
  }

.down {
    transform: rotate(45deg);
    -webkit-transform: rotate(45deg);
  }
</style>
</head>
`

var SCRIPT: string = `
<script>
var acc = document.getElementsByClassName("accordion");
var i;
for (i = 0; i < acc.length; i++) {
  acc[i].addEventListener("click", function() {
    /* Toggle between adding and removing the "active" class,
    to highlight the button that controls the panel */
    this.classList.toggle("active");

    /* Toggle between hiding and showing the active panel */
    var panel = this.nextElementSibling;
    if (panel.style.display === "block") {
      panel.style.display = "none";
    } else {
      panel.style.display = "block";
    }
  });
}
</script>
`