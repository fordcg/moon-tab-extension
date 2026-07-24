import type { ModelToolCall, ModelToolResult } from "../../shared/models/types";

export interface BrowserControlCommandConnection {
  resolveNodeByBackendId(backendNodeId: number): Promise<unknown>;
  scrollIntoViewIfNeeded(objectId: string): Promise<unknown>;
  getBoxModel(backendNodeId: number): Promise<unknown>;
  callFunctionOn(params: Record<string, unknown>): Promise<unknown>;
  evaluate(params: Record<string, unknown>): Promise<unknown>;
  dispatchMouseEvent(params: Record<string, unknown>): Promise<unknown>;
  dispatchKeyEvent(params: Record<string, unknown>): Promise<unknown>;
  insertText(text: string): Promise<unknown>;
}

export interface BrowserControlActionSnapshot {
  getBackendNodeId(uid: string): number;
  takeSnapshot(): Promise<string>;
}

export interface BrowserControlActionOptions {
  waitForNetworkIdle?: (options: { timeoutMs?: number }) => Promise<{ ok: true; idleMs: number } | { ok: false; message: string }>;
}

type BrowserControlActionName = "click" | "fill" | "press_key" | "wait_for" | "wait_for_state" | "scroll" | "hover" | "double_click" | "context_click" | "drag";
type ScrollDirection = "up" | "down" | "left" | "right" | "top" | "bottom";
type WaitForStateName = "url_contains" | "ready_state" | "element_visible" | "element_hidden" | "network_idle";

interface ElementInfo {
  tagName: string;
  type: string;
  role: string;
  isContentEditable: boolean;
}

const BROWSER_ACTION_DISABLED_MESSAGE = "浏览器控制未开启，无法执行浏览器操作。请先在顶部浏览器控制按钮中显式开启。";
const RETAKE_SNAPSHOT_MESSAGE = "请重新调用 take_snapshot 获取最新页面状态后再继续。";
const SAFE_CLICK_OCCLUDED_ERROR = "元素当前被遮挡，无法安全点击。";
const MODIFIER_BITS = {
  Alt: 1,
  Control: 2,
  Meta: 4,
  Shift: 8,
} as const;
const MODIFIER_ALIASES: Record<string, keyof typeof MODIFIER_BITS> = {
  Ctrl: "Control",
  Cmd: "Meta",
  Command: "Meta",
  Option: "Alt",
};

export { isBrowserControlActionName } from "./browserActionHelpers";
import {
  createElementScrollFunctionDeclaration,
  createViewportScrollExpression,
  createWaitForElementStateFunctionDeclaration,
  createWaitForExpression,
  createWaitForPageStateExpression,
  formatElementScrollResult,
  formatViewportScrollResult,
  getBoxModel,
  getKeyDefinition,
  getObject,
  getResultValue,
  isBrowserControlActionName,
  isToggleElement,
  normalizeActionError,
  normalizeScrollAmount,
  normalizeTimeout,
  normalizeWaitForStateResult,
  normalizeWaitForTargets,
  parseKeyTokens,
  validateArguments,
} from "./browserActionHelpers";

export function createBrowserActionDisabledResult(toolCall: ModelToolCall): ModelToolResult {
  return createBrowserActionErrorResult(toolCall, BROWSER_ACTION_DISABLED_MESSAGE);
}

export function createBrowserActionErrorResult(toolCall: ModelToolCall, content: string): ModelToolResult {
  return {
    toolCallId: toolCall.id,
    name: toolCall.name,
    content,
    isError: true,
  };
}

export class BrowserControlActionExecutor {
  constructor(
    private readonly connection: BrowserControlCommandConnection,
    private readonly snapshot: BrowserControlActionSnapshot,
    private readonly options: BrowserControlActionOptions = {},
  ) {}

  async execute(toolCall: ModelToolCall): Promise<ModelToolResult> {
    if (!isBrowserControlActionName(toolCall.name)) {
      return createBrowserActionErrorResult(toolCall, `未知的浏览器操作工具：${toolCall.name}。`);
    }

    const validation = validateArguments(toolCall);
    if (!validation.ok) {
      return createBrowserActionErrorResult(toolCall, validation.message);
    }

    try {
      const content = await this.executeAction(toolCall.name, toolCall.arguments);
      return {
        toolCallId: toolCall.id,
        name: toolCall.name,
        content,
      };
    } catch (error) {
      return createBrowserActionErrorResult(toolCall, normalizeActionError(error, Boolean(toolCall.arguments.includeSnapshot)));
    }
  }

  private async executeAction(name: BrowserControlActionName, args: Record<string, unknown>): Promise<string> {
    if (name === "click") {
      return this.click(String(args.uid));
    }
    if (name === "fill") {
      return this.fill(String(args.uid), String(args.value));
    }
    if (name === "press_key") {
      return this.pressKey(String(args.key));
    }
    if (name === "scroll") {
      return this.scroll(String(args.direction), args.amount, typeof args.uid === "string" ? args.uid : undefined);
    }
    if (name === "hover") {
      return this.hover(String(args.uid));
    }
    if (name === "double_click") {
      return this.doubleClick(String(args.uid));
    }
    if (name === "context_click") {
      return this.contextClick(String(args.uid));
    }
    if (name === "wait_for_state") {
      return this.waitForState(String(args.state), args.value, args.uid, args.timeout);
    }
    if (name === "drag") {
      return this.drag(args);
    }

    return this.waitFor(args.text, args.timeout);
  }

  private async click(uid: string): Promise<string> {
    const objectId = await this.getObjectIdFromUid(uid);
    const backendNodeId = this.snapshot.getBackendNodeId(uid);

    try {
      const { x, y } = await this.getElementCenter(objectId, backendNodeId);
      const hitTest = await this.connection.callFunctionOn({
        objectId,
        functionDeclaration: `function(x, y) {
          const hitElement = document.elementFromPoint(x, y);
          if (!hitElement) return false;
          return this.contains(hitElement) || hitElement.contains(this);
        }`,
        arguments: [{ value: x }, { value: y }],
        returnByValue: true,
      });
      if (getResultValue(hitTest) === false) {
        throw new Error(SAFE_CLICK_OCCLUDED_ERROR);
      }

      await this.connection.dispatchMouseEvent({ type: "mouseMoved", x, y });
      await this.connection.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
      await this.connection.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    } catch (error) {
      if (error instanceof Error && error.message === SAFE_CLICK_OCCLUDED_ERROR) {
        throw error;
      }

      await this.connection.callFunctionOn({
        objectId,
        // 这里是固定的受控 fallback，只允许补发鼠标事件和聚焦；不要扩展为模型可控脚本入口。
        functionDeclaration: `function() {
          this.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
          const rect = this.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
            this.dispatchEvent(new MouseEvent(type, {
              view: window,
              bubbles: true,
              cancelable: true,
              composed: true,
              buttons: 1,
              clientX: x,
              clientY: y,
            }));
          }
          if (typeof this.focus === "function") this.focus();
        }`,
        userGesture: true,
      });
    }

    return `已点击元素 ${uid}。`;
  }

  private async hover(uid: string): Promise<string> {
    const objectId = await this.getObjectIdFromUid(uid);
    const backendNodeId = this.snapshot.getBackendNodeId(uid);
    const { x, y } = await this.getElementCenter(objectId, backendNodeId);
    await this.connection.dispatchMouseEvent({ type: "mouseMoved", x, y });
    return `已悬停元素 ${uid}。`;
  }

  private async doubleClick(uid: string): Promise<string> {
    const objectId = await this.getObjectIdFromUid(uid);
    const backendNodeId = this.snapshot.getBackendNodeId(uid);
    const { x, y } = await this.getElementCenter(objectId, backendNodeId);
    await this.connection.dispatchMouseEvent({ type: "mouseMoved", x, y });
    await this.connection.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await this.connection.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    await this.connection.dispatchMouseEvent({ type: "mousePressed", x, y, button: "left", clickCount: 2 });
    await this.connection.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "left", clickCount: 2 });
    return `已双击元素 ${uid}。`;
  }

  private async contextClick(uid: string): Promise<string> {
    const objectId = await this.getObjectIdFromUid(uid);
    const backendNodeId = this.snapshot.getBackendNodeId(uid);
    const { x, y } = await this.getElementCenter(objectId, backendNodeId);
    await this.connection.dispatchMouseEvent({ type: "mouseMoved", x, y });
    await this.connection.dispatchMouseEvent({ type: "mousePressed", x, y, button: "right", clickCount: 1 });
    await this.connection.dispatchMouseEvent({ type: "mouseReleased", x, y, button: "right", clickCount: 1 });
    return `已右键元素 ${uid}。`;
  }

  private async drag(args: Record<string, unknown>): Promise<string> {
    const sourceUid = String(args.sourceUid);
    const source = await this.getElementPoint(sourceUid);
    let target: { x: number; y: number };
    let resultText: string;

    if (typeof args.targetUid === "string" && args.targetUid.trim()) {
      target = await this.getElementPoint(args.targetUid);
      resultText = `已将元素 ${sourceUid} 拖拽到元素 ${args.targetUid}。`;
    } else {
      const deltaX = Number(args.deltaX);
      const deltaY = Number(args.deltaY);
      target = { x: source.x + deltaX, y: source.y + deltaY };
      resultText = `已将元素 ${sourceUid} 拖拽偏移 x=${deltaX}，y=${deltaY}。`;
    }

    await this.connection.dispatchMouseEvent({ type: "mouseMoved", x: source.x, y: source.y });
    await this.connection.dispatchMouseEvent({ type: "mousePressed", x: source.x, y: source.y, button: "left", clickCount: 1 });
    await this.connection.dispatchMouseEvent({
      type: "mouseMoved",
      x: (source.x + target.x) / 2,
      y: (source.y + target.y) / 2,
      button: "left",
      buttons: 1,
    });
    await this.connection.dispatchMouseEvent({ type: "mouseMoved", x: target.x, y: target.y, button: "left", buttons: 1 });
    await this.connection.dispatchMouseEvent({ type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1 });
    return resultText;
  }

  private async fill(uid: string, value: string): Promise<string> {
    const objectId = await this.getObjectIdFromUid(uid);
    const info = await this.getElementInfo(objectId);

    if (info.tagName === "SELECT") {
      await this.fillSelect(objectId, value);
      return `已填写元素 ${uid}。`;
    }

    if (isToggleElement(info)) {
      await this.fillToggle(objectId, value);
      return `已填写元素 ${uid}。`;
    }

    await this.fillTextInput(objectId, value);
    return `已填写元素 ${uid}。`;
  }

  private async pressKey(key: string): Promise<string> {
    const tokens = parseKeyTokens(key);
    const mainKey = tokens[tokens.length - 1];
    const modifiers = tokens.slice(0, -1);
    const mainDefinition = getKeyDefinition(mainKey, 0);
    if (!mainDefinition) {
      throw new Error(`按键 ${key} 不在允许列表中。`);
    }

    for (const modifier of modifiers) {
      if (!(modifier in MODIFIER_BITS)) {
        throw new Error(`修饰键 ${modifier} 不在允许列表中。`);
      }
    }

    let modifierBits = 0;

    try {
      for (const modifier of modifiers) {
        modifierBits |= MODIFIER_BITS[modifier as keyof typeof MODIFIER_BITS];
        await this.connection.dispatchKeyEvent({
          type: "keyDown",
          ...getKeyDefinition(modifier, modifierBits),
        });
      }

      const modifiedMainDefinition = getKeyDefinition(mainKey, modifierBits);
      await this.connection.dispatchKeyEvent({ type: "keyDown", ...modifiedMainDefinition });
      await this.connection.dispatchKeyEvent({ type: "keyUp", ...modifiedMainDefinition });
    } finally {
      for (const modifier of [...modifiers].reverse()) {
        if (!(modifier in MODIFIER_BITS)) {
          continue;
        }
        modifierBits &= ~MODIFIER_BITS[modifier as keyof typeof MODIFIER_BITS];
        await this.connection.dispatchKeyEvent({
          type: "keyUp",
          ...getKeyDefinition(modifier, modifierBits),
        });
      }
    }

    return `已按下按键 ${key}。`;
  }

  private async waitFor(text: unknown, timeout: unknown): Promise<string> {
    const targets = normalizeWaitForTargets(text);
    if (!targets.length) {
      throw new Error("wait_for 的 text 必须包含至少一个非空文本。");
    }

    const timeoutMs = normalizeTimeout(timeout);
    const response = await this.connection.evaluate({
      expression: createWaitForExpression(targets, timeoutMs),
      awaitPromise: true,
      returnByValue: true,
    });
    const matchedText = getResultValue(response);
    if (typeof matchedText === "string" && matchedText) {
      return `已等待到页面文本：${matchedText}。`;
    }

    throw new Error(`等待页面文本超时：${targets.join("、")}。`);
  }

  private async waitForState(state: string, value: unknown, uid: unknown, timeout: unknown): Promise<string> {
    const normalizedState = state as WaitForStateName;
    const timeoutMs = normalizeTimeout(timeout);
    if (normalizedState === "network_idle") {
      if (!this.options.waitForNetworkIdle) {
        throw new Error("Network 采集未开启，无法等待 Network 空闲。");
      }
      const result = await this.options.waitForNetworkIdle({ timeoutMs });
      if (result.ok) {
        return "已等待到页面状态：network_idle。";
      }
      throw new Error(result.message);
    }
    if (normalizedState === "element_visible" || normalizedState === "element_hidden") {
      const normalizedUid = String(uid);
      const objectId = await this.getObjectIdFromUid(normalizedUid);
      const response = await this.connection.callFunctionOn({
        objectId,
        functionDeclaration: createWaitForElementStateFunctionDeclaration(),
        arguments: [{ value: normalizedState }, { value: timeoutMs }],
        returnByValue: true,
        awaitPromise: true,
      });
      const result = normalizeWaitForStateResult(getResultValue(response));
      if (result.matched) {
        return `已等待到页面状态：${normalizedState}=${normalizedUid}。`;
      }
      throw new Error(`等待页面状态超时：${normalizedState}=${normalizedUid}。`);
    }

    const targetValue = String(value);
    const response = await this.connection.evaluate({
      expression: createWaitForPageStateExpression(normalizedState, targetValue, timeoutMs),
      awaitPromise: true,
      returnByValue: true,
    });
    const result = normalizeWaitForStateResult(getResultValue(response));
    if (result.matched) {
      return `已等待到页面状态：${normalizedState}=${targetValue}。`;
    }
    throw new Error(`等待页面状态超时：${normalizedState}=${targetValue}。`);
  }

  private async scroll(direction: string, amount: unknown, uid?: string): Promise<string> {
    const normalizedDirection = direction as ScrollDirection;
    const normalizedAmount = normalizeScrollAmount(amount);
    const normalizedUid = uid?.trim();
    if (normalizedUid) {
      const objectId = await this.getObjectIdFromUid(normalizedUid);
      const response = await this.connection.callFunctionOn({
        objectId,
        functionDeclaration: createElementScrollFunctionDeclaration(),
        arguments: [{ value: normalizedDirection }, { value: normalizedAmount }],
        returnByValue: true,
      });
      if (getResultValue(response) !== true) {
        throw new Error(`元素 ${normalizedUid} 不支持滚动。`);
      }
      return formatElementScrollResult(normalizedUid, normalizedDirection, normalizedAmount);
    }

    const response = await this.connection.evaluate({
      expression: createViewportScrollExpression(normalizedDirection, normalizedAmount),
      awaitPromise: true,
      returnByValue: true,
    });
    if (getResultValue(response) !== true) {
      throw new Error("页面视口滚动失败，请确认当前页面仍可访问后重试。");
    }
    return formatViewportScrollResult(normalizedDirection, normalizedAmount);
  }

  private async getObjectIdFromUid(uid: string): Promise<string> {
    const backendNodeId = this.snapshot.getBackendNodeId(uid);
    const response = await this.connection.resolveNodeByBackendId(backendNodeId);
    const object = getObject(response);
    if (!object?.objectId) {
      throw new Error(`元素 ${uid} 已从页面中移除。`);
    }

    return object.objectId;
  }

  private async getElementCenter(objectId: string, backendNodeId: number): Promise<{ x: number; y: number }> {
    await this.connection.scrollIntoViewIfNeeded(objectId);
    const response = await this.connection.getBoxModel(backendNodeId);
    const model = getBoxModel(response);
    if (!model?.content || model.content.length < 8) {
      throw new Error("无法读取元素布局。");
    }

    return {
      x: (model.content[0] + model.content[4]) / 2,
      y: (model.content[1] + model.content[5]) / 2,
    };
  }

  private async getElementPoint(uid: string): Promise<{ x: number; y: number }> {
    const objectId = await this.getObjectIdFromUid(uid);
    const backendNodeId = this.snapshot.getBackendNodeId(uid);
    return this.getElementCenter(objectId, backendNodeId);
  }

  private async getElementInfo(objectId: string): Promise<ElementInfo> {
    const response = await this.connection.callFunctionOn({
      objectId,
      functionDeclaration: `function() {
        return {
          tagName: String(this.tagName || "").toUpperCase(),
          type: String(this.type || "").toLowerCase(),
          role: String((this.getAttribute && this.getAttribute("role")) || "").toLowerCase(),
          isContentEditable: Boolean(this.isContentEditable),
        };
      }`,
      returnByValue: true,
    });
    const value = getResultValue(response);
    if (!value || typeof value !== "object") {
      return { tagName: "", type: "", role: "", isContentEditable: false };
    }

    const info = value as Partial<ElementInfo>;
    return {
      tagName: typeof info.tagName === "string" ? info.tagName.toUpperCase() : "",
      type: typeof info.type === "string" ? info.type.toLowerCase() : "",
      role: typeof info.role === "string" ? info.role.toLowerCase() : "",
      isContentEditable: info.isContentEditable === true,
    };
  }

  private async fillSelect(objectId: string, value: string): Promise<void> {
    const response = await this.connection.callFunctionOn({
      objectId,
      functionDeclaration: `function(targetValue) {
        let matched = false;
        for (const option of Array.from(this.options || [])) {
          if (option.value === targetValue || option.text === targetValue) {
            this.value = option.value;
            matched = true;
            break;
          }
        }
        if (!matched) return false;
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }`,
      arguments: [{ value }],
      returnByValue: true,
    });
    if (getResultValue(response) !== true) {
      throw new Error(`下拉框中没有匹配的选项：${value}。`);
    }
  }

  private async fillToggle(objectId: string, value: string): Promise<void> {
    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue !== "true" && normalizedValue !== "false") {
      throw new Error("复选框、单选框和开关只能填写 true 或 false。");
    }

    await this.connection.callFunctionOn({
      objectId,
      functionDeclaration: `function(nextChecked) {
        const dispatchStateEvents = () => {
          this.dispatchEvent(new Event("input", { bubbles: true }));
          this.dispatchEvent(new Event("change", { bubbles: true }));
        };
        if (this instanceof HTMLInputElement) {
          if (this.checked !== nextChecked && typeof this.click === "function") this.click();
          if (this.checked !== nextChecked) {
            this.checked = nextChecked;
            dispatchStateEvents();
          }
          return;
        }
        const nextValue = nextChecked ? "true" : "false";
        if (this.getAttribute && this.getAttribute("aria-checked") !== null) this.setAttribute("aria-checked", nextValue);
        if (this.getAttribute && this.getAttribute("aria-pressed") !== null) this.setAttribute("aria-pressed", nextValue);
        if (typeof this.click === "function") this.click();
        dispatchStateEvents();
      }`,
      arguments: [{ value: normalizedValue === "true" }],
      userGesture: true,
    });
  }

  private async fillTextInput(objectId: string, value: string): Promise<void> {
    await this.connection.callFunctionOn({
      objectId,
      functionDeclaration: `function() {
        this.focus();
        if (typeof this.select === "function") {
          this.select();
          return;
        }
        if (window.getSelection && document.createRange) {
          const range = document.createRange();
          range.selectNodeContents(this);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
        }
      }`,
    });
    await this.connection.dispatchKeyEvent({
      type: "keyDown",
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
      key: "Backspace",
      code: "Backspace",
    });
    await this.connection.dispatchKeyEvent({
      type: "keyUp",
      windowsVirtualKeyCode: 8,
      nativeVirtualKeyCode: 8,
      key: "Backspace",
      code: "Backspace",
    });
    if (value) {
      await this.connection.insertText(value);
    }
    await this.connection.callFunctionOn({
      objectId,
      // 空字符串是明确的清空语义；这里兜底清理残留值，避免全选或 Backspace 被页面框架干扰后只删掉一个字符。
      arguments: [{ value }],
      functionDeclaration: `function() {
        if (arguments[0] === "" && "value" in this) {
          this.value = "";
          this.dispatchEvent(new Event("input", { bubbles: true }));
        }
        this.dispatchEvent(new Event("change", { bubbles: true }));
      }`,
    });
  }

}

