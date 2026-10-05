/**
 * 安卓端「音频窗口」通道（Cordova InAppBrowser）
 *
 * 桌面端用 Electron 的隐藏 BrowserWindow 当音频窗口；安卓端没有第二个窗口，
 * 但客户端装了 cordova-plugin-inappbrowser（无名杀用它开外部链接），
 * 可以用 InAppBrowser 开一个独立 WebView 当音频窗口 —— 它和游戏页面同源
 * （`https://localhost/extension/网易云音乐盒/player.html`），因此两边直接
 * 用 localStorage 通信：
 *
 *   游戏页面 -> 写 nmb_iab_cmd_v1   （load / play / pause / stop / seek / volume / close）
 *   音频窗口 -> 写 nmb_iab_state_v1 （hasSrc / paused / currentTime / duration / volume / error …）
 *   游戏页面 -> 写 nmb_iab_beat_v1  （心跳；音频窗口长时间收不到就自己关掉）
 *
 * 关键点：游戏页面执行 window.location.reload()（重新开始）时，InAppBrowser 那个
 * WebView 仍然活着、音乐继续播放；新页面只要读到「新鲜」的状态就能直接接管，
 * 于是实现"重开不断歌"。整条通道都是轮询式的（不依赖 storage 事件跨 WebView 传递），
 * 因此在不同客户端上都可靠。
 */
export const CMD_KEY = "nmb_iab_cmd_v1";
export const STATE_KEY = "nmb_iab_state_v1";
export const BEAT_KEY = "nmb_iab_beat_v1";

/** 状态多久没更新就认为音频窗口已经没了 */
export const STATE_FRESH_MS = 7000;
/** 音频窗口多久收不到心跳就自己关闭 */
export const BEAT_TIMEOUT_MS = 90000;

/** 音频窗口页面（相对游戏根目录，与扩展目录一致） */
export const SINK_PAGE = "extension/网易云音乐盒/player.html";

/** 音频窗口的 URL（与游戏页面同源） */
export function sinkUrl() {
	try {
		return new URL(SINK_PAGE, location.href).toString();
	} catch (e) {
		return SINK_PAGE;
	}
}

function storage() {
	try {
		return typeof localStorage !== "undefined" ? localStorage : null;
	} catch (e) {
		return null;
	}
}

export function readRaw(key) {
	const store = storage();
	try {
		return store ? store.getItem(key) : null;
	} catch (e) {
		return null;
	}
}

export function writeRaw(key, value) {
	const store = storage();
	try {
		if (!store) {
			return false;
		}
		store.setItem(key, value);
		return true;
	} catch (e) {
		return false;
	}
}

export function removeRaw(key) {
	const store = storage();
	try {
		if (store) {
			store.removeItem(key);
		}
	} catch (e) {}
}

/** 读取音频窗口上报的状态 */
export function readSinkState() {
	const raw = readRaw(STATE_KEY);
	if (!raw) {
		return null;
	}
	try {
		const state = JSON.parse(raw);
		return state && typeof state === "object" ? state : null;
	} catch (e) {
		return null;
	}
}

/** 音频窗口是否还活着（状态足够新，且没有被标记为已关闭） */
export function isSinkAlive(state) {
	const current = state === undefined ? readSinkState() : state;
	if (!current || current.closed) {
		return false;
	}
	return Number.isFinite(current.ts) && Date.now() - current.ts < STATE_FRESH_MS;
}

/** 给音频窗口发一条命令 */
export function sendCommand(action, payload = {}) {
	const command = { action, ...payload, ts: Date.now(), seq: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}` };
	return writeRaw(CMD_KEY, JSON.stringify(command)) ? command : null;
}

/** 读取待执行的命令（音频窗口侧用） */
export function readCommand() {
	const raw = readRaw(CMD_KEY);
	if (!raw) {
		return null;
	}
	try {
		const command = JSON.parse(raw);
		return command && typeof command === "object" ? command : null;
	} catch (e) {
		return null;
	}
}

/** 写心跳（游戏页面定期调用） */
export function beat() {
	return writeRaw(BEAT_KEY, String(Date.now()));
}

/** 读心跳（音频窗口侧用） */
export function readBeat() {
	const value = Number(readRaw(BEAT_KEY));
	return Number.isFinite(value) ? value : 0;
}

/** 清掉通道数据（关闭音频窗口后调用） */
export function clearChannel() {
	removeRaw(STATE_KEY);
	removeRaw(CMD_KEY);
}

/** 只清状态（音频窗口还在，等着它处理 close 命令） */
export function clearState() {
	removeRaw(STATE_KEY);
}

/** 清命令 */
export function clearCommand() {
	removeRaw(CMD_KEY);
}

/** 清掉可能残留的旧命令（新开音频窗口前调用，避免读到上一条 close） */
export function resetCommand() {
	sendCommand("none");
}
