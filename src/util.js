/**
 * 网易云音乐盒 - 通用工具
 */

/** 网易云音乐站点 */
export const BASE_URL = "https://music.163.com";
/** 网易云登录页（外置浏览器打开用） */
export const LOGIN_URL = "https://music.163.com/#/login";
/** 手机端网页版（登录后可直接看到自己的歌单） */
export const LOGIN_URL_MOBILE = "https://music.163.com/m/login";

/**
 * 获取 Node 的 require（无名杀桌面端开启了 nodeIntegration）
 * @returns {((name: string) => any) | null}
 */
export function getRequire() {
	try {
		if (typeof window !== "undefined" && typeof window.require === "function") {
			return window.require.bind(window);
		}
	} catch (e) {}
	try {
		if (typeof require === "function") {
			return require;
		}
	} catch (e) {}
	return null;
}

/**
 * 调用系统默认浏览器打开链接（不再是游戏内嵌窗口）
 * @param {string} url
 * @returns {boolean} 是否成功调用
 */
export function openExternal(url) {
	// 安卓 / iOS 客户端（Cordova）：用 InAppBrowser 调起系统浏览器
	try {
		const win = typeof window !== "undefined" ? window : null;
		const cordova = win && win.cordova;
		if (cordova) {
			const inAppBrowser = cordova.InAppBrowser || (cordova.plugins && cordova.plugins.inAppBrowser);
			if (inAppBrowser && typeof inAppBrowser.open === "function") {
				inAppBrowser.open(url, "_system");
				return true;
			}
		}
	} catch (e) {}
	const req = getRequire();
	if (req) {
		// 无名杀主进程已初始化并启用了 @electron/remote
		try {
			const remote = req("@electron/remote");
			if (remote && remote.shell && typeof remote.shell.openExternal === "function") {
				remote.shell.openExternal(url);
				return true;
			}
		} catch (e) {}
		try {
			const electron = req("electron");
			if (electron && electron.shell && typeof electron.shell.openExternal === "function") {
				electron.shell.openExternal(url);
				return true;
			}
		} catch (e) {}
	}
	// 网页版兜底
	try {
		const node = document.createElement("a");
		node.href = url;
		node.target = "_blank";
		node.rel = "noopener noreferrer";
		node.style.display = "none";
		document.body.appendChild(node);
		node.click();
		node.remove();
		return true;
	} catch (e) {}
	return false;
}

/** 是否运行在安卓/iOS 客户端（Cordova）里 */
export function isCordova() {
	try {
		return !!(typeof window !== "undefined" && window.cordova);
	} catch (e) {
		return false;
	}
}

/** 是否运行在桌面端（Electron，且启用了 @electron/remote） */
export function isDesktop() {
	const req = getRequire();
	if (!req) {
		return false;
	}
	try {
		const remote = req("@electron/remote");
		return !!(remote && remote.BrowserWindow);
	} catch (e) {
		// 安卓客户端的 cordova require 对未知模块会抛错，这里即视为非桌面端
		return false;
	}
}

/**
 * 触发一次系统级下载（用于导出会话等）
 * @param {string} name
 * @param {string} text
 */
export function downloadText(name, text) {
	try {
		const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = name;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 5000);
	} catch (e) {}
}

/** HTML 转义 */
export function escapeHtml(str) {
	return String(str ?? "").replace(/[&<>"']/g, ch => {
		switch (ch) {
			case "&":
				return "&amp;";
			case "<":
				return "&lt;";
			case ">":
				return "&gt;";
			case '"':
				return "&quot;";
			default:
				return "&#39;";
		}
	});
}

/** 毫秒 -> mm:ss */
export function formatTime(ms) {
	if (!isFinite(ms) || ms < 0) {
		ms = 0;
	}
	const total = Math.floor(ms / 1000);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m < 10 ? "0" : ""}${m}:${s < 10 ? "0" : ""}${s}`;
}

/** 播放量等数字的友好显示 */
export function formatCount(num) {
	const n = Number(num) || 0;
	if (n >= 100000000) {
		return `${(n / 100000000).toFixed(1)}亿`;
	}
	if (n >= 10000) {
		return `${(n / 10000).toFixed(1)}万`;
	}
	return String(n);
}

/** 限制取值范围 */
export function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

/**
 * 从用户输入中解析歌单 ID
 * 支持：纯数字、歌单链接（含 #/playlist?id=xxx）、分享文本
 * @param {string} input
 * @returns {string} 解析出的 ID，失败返回空串
 */
export function parsePlaylistId(input) {
	const text = String(input || "").trim();
	if (!text) {
		return "";
	}
	if (/^\d{3,}$/.test(text)) {
		return text;
	}
	const matched = text.match(/playlist[/?#]+(?:[^?\s]*[?&])?id=(\d{3,})/i) || text.match(/[?&]id=(\d{3,})/i) || text.match(/(\d{5,})/);
	return matched ? matched[1] : "";
}

/** 简易事件触发器 */
export class Emitter {
	constructor() {
		this._handlers = {};
	}
	on(type, handler) {
		(this._handlers[type] || (this._handlers[type] = [])).push(handler);
		return () => this.off(type, handler);
	}
	off(type, handler) {
		const list = this._handlers[type];
		if (!list) {
			return;
		}
		const index = list.indexOf(handler);
		if (index >= 0) {
			list.splice(index, 1);
		}
	}
	emit(type, ...args) {
		const list = this._handlers[type];
		if (!list) {
			return;
		}
		for (const handler of list.slice()) {
			try {
				handler(...args);
			} catch (e) {
				console.error("[网易云音乐盒] 事件处理出错", e);
			}
		}
	}
}

/** 统一的对象存储键前缀 */
export const EXT_NAME = "网易云音乐盒";
export const CONFIG_PREFIX = `extension_${EXT_NAME}_`;
