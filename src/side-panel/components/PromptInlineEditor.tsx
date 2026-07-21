import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type {
  ClipboardEvent as ReactClipboardEvent,
  CompositionEvent as ReactCompositionEvent,
  KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { ChatPromptInvocation } from "../../shared/types";

export interface ComposerTabMention {
  tabId: number;
  title: string;
  url: string;
  favIconUrl?: string;
}

export interface PromptInlineDocument {
  text: string;
  promptInvocations: ChatPromptInvocation[];
  tabMentions: ComposerTabMention[];
}

export interface PromptInlineEditorHandle {
  insertCommand: (prompt: ChatPromptInvocation) => void;
  insertMention: (mention: ComposerTabMention) => void;
  clear: () => void;
  focus: () => void;
}

interface PromptInlineEditorProps {
  ariaLabel: string;
  className?: string;
  /** Change this value to force-clear or re-seed the editor. */
  resetVersion?: number;
  seedText?: string;
  seedPromptInvocations?: ChatPromptInvocation[];
  seedTabMentions?: ComposerTabMention[];
  promptAriaLabelPrefix: string;
  onChange: (document: PromptInlineDocument) => void;
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void;
  onPaste?: (event: ReactClipboardEvent<HTMLElement>) => void;
  onCompositionStart?: (event: ReactCompositionEvent<HTMLElement>) => void;
  onCompositionEnd?: (document: PromptInlineDocument, event: ReactCompositionEvent<HTMLElement>) => void;
}

export const PromptInlineEditor = forwardRef<PromptInlineEditorHandle, PromptInlineEditorProps>(
  function PromptInlineEditor(
    {
      ariaLabel,
      className,
      resetVersion = 0,
      seedText = "",
      seedPromptInvocations = [],
      seedTabMentions = [],
      promptAriaLabelPrefix,
      onChange,
      onKeyDown,
      onPaste,
      onCompositionStart,
      onCompositionEnd,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLDivElement>(null);
    const lastSignatureRef = useRef("");
    // Keep seeds in refs so hydrate can read latest values without re-running on every keystroke.
    const seedRef = useRef({
      text: seedText,
      promptInvocations: seedPromptInvocations,
      tabMentions: seedTabMentions,
      promptAriaLabelPrefix,
    });
    seedRef.current = {
      text: seedText,
      promptInvocations: seedPromptInvocations,
      tabMentions: seedTabMentions,
      promptAriaLabelPrefix,
    };

    const readDocument = (): PromptInlineDocument => {
      if (!editorRef.current) {
        return { text: "", promptInvocations: [], tabMentions: [] };
      }
      return serializeEditor(editorRef.current);
    };

    const emitChange = () => {
      const documentValue = readDocument();
      const signature = JSON.stringify(documentValue);
      if (signature === lastSignatureRef.current) {
        return;
      }
      lastSignatureRef.current = signature;
      onChange(documentValue);
    };

    const hydrate = (documentValue: PromptInlineDocument, labelPrefix: string) => {
      const editor = editorRef.current;
      if (!editor) {
        return;
      }
      editor.innerHTML = "";
      for (const prompt of documentValue.promptInvocations) {
        editor.appendChild(createCommandNode(prompt, labelPrefix));
        editor.appendChild(document.createTextNode(" "));
      }
      for (const mention of documentValue.tabMentions) {
        editor.appendChild(createMentionNode(mention));
        editor.appendChild(document.createTextNode(" "));
      }
      if (documentValue.text) {
        editor.appendChild(document.createTextNode(documentValue.text));
      }
      editor.normalize();
      lastSignatureRef.current = JSON.stringify(serializeEditor(editor));
    };

    useImperativeHandle(ref, () => ({
      insertCommand: (prompt) => {
        const editor = editorRef.current;
        if (!editor) {
          return;
        }
        focusEditor(editor);
        removeTriggerTokenBeforeCaret(editor, "/");
        insertNodesAtCaret(editor, [createCommandNode(prompt, promptAriaLabelPrefix), document.createTextNode(" ")]);
        emitChange();
      },
      insertMention: (mention) => {
        const editor = editorRef.current;
        if (!editor) {
          return;
        }
        focusEditor(editor);
        removeTriggerTokenBeforeCaret(editor, "@");
        insertNodesAtCaret(editor, [createMentionNode(mention), document.createTextNode(" ")]);
        emitChange();
      },
      clear: () => {
        const editor = editorRef.current;
        if (!editor) {
          return;
        }
        editor.innerHTML = "";
        lastSignatureRef.current = "";
        onChange({ text: "", promptInvocations: [], tabMentions: [] });
      },
      focus: () => {
        if (editorRef.current) {
          focusEditor(editorRef.current);
        }
      },
    }));

    // Only re-seed when the parent bumps resetVersion (send / open edit).
    // Do NOT depend on seed arrays: default [] is a new reference every render and would wipe typing.
    useLayoutEffect(() => {
      const seed = seedRef.current;
      hydrate(
        {
          text: seed.text,
          promptInvocations: seed.promptInvocations,
          tabMentions: seed.tabMentions,
        },
        seed.promptAriaLabelPrefix,
      );
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resetVersion]);

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.key === "Backspace" && !event.nativeEvent.isComposing) {
        const removed = removeAtomicTokenBeforeCaret(editorRef.current);
        if (removed) {
          event.preventDefault();
          emitChange();
          return;
        }
      }

      onKeyDown?.(event);
      if (event.defaultPrevented) {
        return;
      }

      if (event.key === "Enter" && !event.nativeEvent.isComposing) {
        event.preventDefault();
        insertNodesAtCaret(editorRef.current, [document.createTextNode("\n")]);
        emitChange();
      }
    };

    const handlePaste = (event: ReactClipboardEvent<HTMLElement>) => {
      onPaste?.(event);
      if (event.defaultPrevented) {
        return;
      }

      const plainText = event.clipboardData.getData("text/plain");
      if (!plainText) {
        return;
      }

      event.preventDefault();
      insertNodesAtCaret(editorRef.current, [document.createTextNode(plainText)]);
      emitChange();
    };

    const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
      const target = event.target;
      if (!(target instanceof Element) || !editorRef.current) {
        return;
      }
      const token = target.closest<HTMLElement>("[data-prompt-id], [data-tab-id]");
      if (!token || !editorRef.current.contains(token)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      token.remove();
      editorRef.current.normalize();
      placeCaretAtEnd(editorRef.current);
      emitChange();
    };

    return (
      <div
        className={`prompt-inline-editor${className ? ` ${className}` : ""}`}
        onClick={() => editorRef.current && focusEditor(editorRef.current)}
      >
        <div
          ref={editorRef}
          className="prompt-inline-editor-text"
          role="textbox"
          aria-label={ariaLabel}
          aria-multiline="true"
          contentEditable
          suppressContentEditableWarning
          tabIndex={0}
          onClick={handleClick}
          onInput={emitChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onCompositionStart={onCompositionStart}
          onCompositionEnd={(event) => {
            const documentValue = readDocument();
            lastSignatureRef.current = JSON.stringify(documentValue);
            onCompositionEnd?.(documentValue, event);
          }}
        />
      </div>
    );
  },
);

export function PromptTokenContent({ title }: { title: string }) {
  return <span className="prompt-token-title">{title}</span>;
}

function serializeEditor(editor: HTMLElement): PromptInlineDocument {
  let text = "";
  const promptInvocations: ChatPromptInvocation[] = [];
  const tabMentions: ComposerTabMention[] = [];
  const seenPrompts = new Set<string>();
  const seenTabs = new Set<number>();

  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    const element = node as HTMLElement;
    if (element.dataset.promptId) {
      const promptId = element.dataset.promptId;
      if (!seenPrompts.has(promptId)) {
        seenPrompts.add(promptId);
        promptInvocations.push({
          promptId,
          title: element.dataset.promptTitle || element.textContent?.trim() || promptId,
          contentSnapshot: element.dataset.promptSnapshot || element.dataset.promptTitle || promptId,
        });
      }
      // Keep free text free of command titles; strategy rides on promptInvocations.
      return;
    }
    if (element.dataset.tabId) {
      const tabId = Number(element.dataset.tabId);
      if (Number.isFinite(tabId) && !seenTabs.has(tabId)) {
        seenTabs.add(tabId);
        tabMentions.push({
          tabId,
          title: element.dataset.tabTitle || element.textContent?.trim() || String(tabId),
          url: element.dataset.tabUrl || "",
          favIconUrl: element.dataset.tabFavicon || undefined,
        });
      }
      // Mentions stay as visual tokens only; keep a short marker out of free text.
      return;
    }
    if (element.tagName === "BR") {
      text += "\n";
      return;
    }
    for (const child of Array.from(element.childNodes)) {
      visit(child);
    }
  };

  for (const child of Array.from(editor.childNodes)) {
    visit(child);
  }

  return { text, promptInvocations, tabMentions };
}

function createCommandNode(prompt: ChatPromptInvocation, ariaLabelPrefix: string): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = "prompt-token-link";
  node.contentEditable = "false";
  node.dataset.promptId = prompt.promptId;
  node.dataset.promptTitle = prompt.title;
  node.dataset.promptSnapshot = prompt.contentSnapshot || prompt.title;
  node.setAttribute("aria-label", `${ariaLabelPrefix}：${prompt.title}`);
  node.title = prompt.contentSnapshot || prompt.title;
  node.textContent = prompt.title;
  return node;
}

function createMentionNode(mention: ComposerTabMention): HTMLSpanElement {
  const node = document.createElement("span");
  node.className = "mention-token-link";
  node.contentEditable = "false";
  node.dataset.tabId = String(mention.tabId);
  node.dataset.tabTitle = mention.title;
  node.dataset.tabUrl = mention.url;
  if (mention.favIconUrl) {
    node.dataset.tabFavicon = mention.favIconUrl;
  }
  node.setAttribute("aria-label", `已引用标签页：${mention.title}`);
  node.title = mention.url || mention.title;

  if (mention.favIconUrl) {
    const icon = document.createElement("img");
    icon.className = "mention-token-favicon";
    icon.alt = "";
    icon.src = mention.favIconUrl;
    node.appendChild(icon);
  }

  const title = document.createElement("span");
  title.className = "mention-token-title";
  title.textContent = mention.title || mention.url;
  node.appendChild(title);
  return node;
}

function insertNodesAtCaret(editor: HTMLElement | null, nodes: Node[]) {
  if (!editor || nodes.length === 0) {
    return;
  }
  focusEditor(editor);
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
    for (const node of nodes) {
      editor.appendChild(node);
    }
    placeCaretAtEnd(editor);
    editor.normalize();
    return;
  }

  const range = selection.getRangeAt(0);
  range.deleteContents();
  let last: Node | null = null;
  for (const node of nodes) {
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    last = node;
  }
  if (last) {
    placeCaretAfter(last);
  }
  editor.normalize();
}

function removeTriggerTokenBeforeCaret(editor: HTMLElement, trigger: "/" | "@") {
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return;
  }
  const range = selection.getRangeAt(0);
  if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE || !editor.contains(range.startContainer)) {
    // Fallback: strip trailing trigger text from the last text node.
    stripTrailingTrigger(editor, trigger);
    return;
  }

  const textNode = range.startContainer as Text;
  const value = textNode.textContent ?? "";
  const caret = range.startOffset;
  const before = value.slice(0, caret);
  const match = before.match(new RegExp(`(?:^|\\s)(\\${trigger}[^\\s${trigger}]*)$`));
  if (!match || match.index === undefined) {
    stripTrailingTrigger(editor, trigger);
    return;
  }
  const tokenStart = match.index + (match[0].startsWith(trigger) ? 0 : 1);
  textNode.textContent = `${value.slice(0, tokenStart)}${value.slice(caret)}`;
  const nextCaret = tokenStart;
  const nextRange = document.createRange();
  nextRange.setStart(textNode, Math.min(nextCaret, textNode.textContent?.length ?? 0));
  nextRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(nextRange);
}

function stripTrailingTrigger(editor: HTMLElement, trigger: "/" | "@") {
  // Walk text nodes from end and remove a trailing "/query" or "@query" token.
  const textNodes: Text[] = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }
  for (let index = textNodes.length - 1; index >= 0; index -= 1) {
    const node = textNodes[index];
    const value = node.textContent ?? "";
    if (!value.trim()) {
      continue;
    }
    const match = value.match(new RegExp(`(?:^|\\s)(\\${trigger}[^\\s${trigger}]*)$`));
    if (!match || match.index === undefined) {
      return;
    }
    const tokenStart = match.index + (match[0].startsWith(trigger) ? 0 : 1);
    node.textContent = value.slice(0, tokenStart);
    placeCaretAfter(node);
    return;
  }
}

function removeAtomicTokenBeforeCaret(editor: HTMLElement | null): boolean {
  if (!editor) {
    return false;
  }
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return false;
  }
  const range = selection.getRangeAt(0);
  if (!range.collapsed || !editor.contains(range.startContainer)) {
    return false;
  }

  // Caret at start of a text node with no leading chars, or directly after a token.
  if (range.startContainer.nodeType === Node.TEXT_NODE) {
    if (range.startOffset > 0) {
      return false;
    }
    const previous = previousMeaningfulSibling(range.startContainer);
    if (isAtomicToken(previous)) {
      previous.remove();
      editor.normalize();
      return true;
    }
    return false;
  }

  if (range.startContainer === editor || range.startContainer.nodeType === Node.ELEMENT_NODE) {
    const container = range.startContainer as HTMLElement;
    const index = range.startOffset;
    const previous = container.childNodes[index - 1] ?? null;
    if (isAtomicToken(previous)) {
      previous.remove();
      editor.normalize();
      return true;
    }
  }

  return false;
}

function previousMeaningfulSibling(node: Node): Node | null {
  let current: Node | null = node.previousSibling;
  while (current) {
    if (current.nodeType === Node.TEXT_NODE && !(current.textContent ?? "").length) {
      current = current.previousSibling;
      continue;
    }
    return current;
  }
  const parent = node.parentNode;
  if (!parent || parent === node.getRootNode()) {
    return null;
  }
  // If nested, look at previous sibling of parent.
  return previousMeaningfulSibling(parent);
}

function isAtomicToken(node: Node | null): node is HTMLElement {
  return Boolean(
    node &&
      node.nodeType === Node.ELEMENT_NODE &&
      ((node as HTMLElement).dataset.promptId || (node as HTMLElement).dataset.tabId),
  );
}

function focusEditor(editor: HTMLElement) {
  editor.focus();
  const selection = document.getSelection();
  if (!selection || selection.rangeCount === 0 || !editor.contains(selection.anchorNode)) {
    placeCaretAtEnd(editor);
  }
}

function placeCaretAtEnd(element: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(false);
  const selection = document.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function placeCaretAfter(node: Node) {
  const selection = document.getSelection();
  if (!selection) {
    return;
  }
  const range = document.createRange();
  range.setStartAfter(node);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}
