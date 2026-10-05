/**
 * 音频输出窗口
 *
 * 意义：无名杀的「重新开始 / 重来」会执行 window.location.reload()，
 * 游戏页面里的一切（包括 Audio 元素）都会被销毁；把音频放在这个独立窗口里，
 * 页面重载期间音乐不会中断，重载后游戏页面再重新接管控制。
 *
 * 两种宿主：
 *   1) 桌面端：Electron 隐藏 BrowserWindow，游戏页面用 executeJavaScript 直接调 NMBSink；
 *   2) 安卓端：Cordova InAppBrowser 独立 WebView（同源），游戏页面通过 localStorage
 *      写命令、读状态（见 sink-channel.js），因此页面重载也不会断。
 *
 * 本文件只负责「播放一个给定的 URL」，歌单、下一首等逻辑仍然在游戏页面里。
 */
import { CMD_KEY, STATE_KEY, BEAT_TIMEOUT_MS, readCommand, readBeat, writeRaw } from "./sink-channel.js";

/** 本页面的 window（模块加载时就固定下来） */
const win = window;
const audio = document.getElementById("audio");
let lastError = 0;
/** 游戏页面每次调用（轮询状态也算）都会刷新心跳，用于兜底退出 */
let lastBeat = Date.now();
const HEARTBEAT_TIMEOUT = 45000;
/** 当前曲目信息（由游戏页面随 load 命令带过来，供页面重载后的界面恢复） */
let meta = null;

audio.addEventListener("error", () => {
	lastError = audio.error ? audio.error.code || -1 : -1;
});
audio.addEventListener("playing", () => {
	lastError = 0;
});
audio.addEventListener("canplay", () => {
	lastError = 0;
});

function asResult(promise) {
	if (!promise || typeof promise.then !== "function") {
		return Promise.resolve({ ok: true });
	}
	return promise.then(
		() => ({ ok: true, error: "" }),
		error => ({ ok: false, error: String((error && error.message) || error || "播放失败") })
	);
}

function currentState() {
	return {
		hasSrc: !!(audio.currentSrc || audio.getAttribute("src")),
		paused: !!audio.paused,
		ended: !!audio.ended,
		currentTime: audio.currentTime || 0,
		duration: isFinite(audio.duration) ? audio.duration : 0,
		volume: audio.volume,
		error: lastError,
		readyState: audio.readyState,
		src: audio.currentSrc || audio.getAttribute("src") || "",
		meta: meta || null,
	};
}

/** 每个方法都会刷新心跳（见下方 watchdog 的兜底逻辑） */
win.NMBSink = {
	ping() {
		lastBeat = Date.now();
		return "pong";
	},
	beat() {
		lastBeat = Date.now();
		return Date.now();
	},
	/** 载入并播放 */
	load(url, autoplay = true, trackMeta = null) {
		lastBeat = Date.now();
		lastError = 0;
		if (trackMeta) {
			meta = trackMeta;
		}
		audio.src = url;
		try {
			audio.load();
		} catch (e) {}
		if (!autoplay) {
			return { ok: true, error: "" };
		}
		return asResult(audio.play());
	},
	play() {
		lastBeat = Date.now();
		return asResult(audio.play());
	},
	pause() {
		lastBeat = Date.now();
		audio.pause();
		return { ok: true };
	},
	stop() {
		lastBeat = Date.now();
		audio.pause();
		audio.removeAttribute("src");
		try {
			audio.load();
		} catch (e) {}
		lastError = 0;
		meta = null;
		return { ok: true };
	},
	seek(seconds) {
		lastBeat = Date.now();
		try {
			if (isFinite(seconds)) {
				audio.currentTime = Math.max(0, Number(seconds) || 0);
			}
		} catch (e) {}
		return { ok: true };
	},
	volume(value) {
		lastBeat = Date.now();
		const volume = Math.min(1, Math.max(0, Number(value) || 0));
		audio.volume = volume;
		return { ok: true, volume };
	},
	/** 供游戏页面轮询的状态 */
	state() {
		lastBeat = Date.now();
		return currentState();
	},
};

/* ------------------------------------------------------------------ *
 * 宿主判断
 * ------------------------------------------------------------------ */

let electronAvailable = false;
let remote = null;
let selfWindow = null;
try {
	require("@electron/remote");
	electronAvailable = true;
} catch (e) {
	electronAvailable = false;
}
if (electronAvailable) {
	try {
		remote = require("@electron/remote");
		if (remote && remote.getCurrentWindow) {
			selfWindow = remote.getCurrentWindow();
		}
	} catch (e) {
		remote = null;
		selfWindow = null;
	}
}

function quitSelf() {
	try {
		if (selfWindow && !selfWindow.isDestroyed()) {
			selfWindow.destroy();
			return;
		}
	} catch (e) {}
	try {
		win.close();
	} catch (e) {}
}

/* ------------------------------------------------------------------ *
 * 安卓模式：通过 localStorage 接收命令、上报状态
 * ------------------------------------------------------------------ */

let lastCommandSeq = "";
/** 已经收到 close 命令：停止播放与上报，然后自行关闭 */
let closed = false;

function report() {
	const state = currentState();
	state.ts = Date.now();
	state.mode = "channel";
	state.closed = closed;
	writeRaw(STATE_KEY, JSON.stringify(state));
	return state;
}

/** 收到 close：停播、标记关闭、自行退出 */
function shutdown() {
	if (closed) {
		return;
	}
	closed = true;
	try {
		audio.pause();
	} catch (e) {}
	report();
	quitSelf();
}

function applyCommand(command) {
	if (!command || !command.action) {
		return;
	}
	lastCommandSeq = command.seq || String(command.ts);
	switch (command.action) {
		case "load":
			win.NMBSink.load(command.url, command.autoplay !== false, command.meta || null);
			if (isFinite(command.seconds) && command.seconds > 0) {
				win.NMBSink.seek(command.seconds);
			}
			if (command.volume !== undefined) {
				win.NMBSink.volume(command.volume);
			}
			break;
		case "play":
			win.NMBSink.play();
			break;
		case "pause":
			win.NMBSink.pause();
			break;
		case "stop":
			win.NMBSink.stop();
			break;
		case "seek":
			win.NMBSink.seek(command.seconds);
			break;
		case "volume":
			win.NMBSink.volume(command.volume);
			break;
		case "close":
			shutdown();
			break;
		default:
			break;
	}
}

/** 安卓 InAppBrowser 模式：轮询命令 + 上报状态 + 心跳兜底 */
function startChannelDriver() {
	report();
	try {
		win.addEventListener("storage", event => {
			if (!event.key || event.key === CMD_KEY || event.key === null) {
				const command = readCommand();
				if (command && command.seq !== lastCommandSeq) {
					applyCommand(command);
				}
			}
		});
	} catch (e) {}
	setInterval(() => {
		if (closed) {
			return;
		}
		// 命令：不能只依赖 storage 事件（跨 WebView 不一定传），所以定时拉一次
		const command = readCommand();
		if (command && command.seq !== lastCommandSeq) {
			applyCommand(command);
		}
		if (closed) {
			return;
		}
		report();
		// 心跳：长时间收不到游戏页面的心跳就自己退出（关掉整个游戏时用）
		const beat = readBeat();
		if (beat && Date.now() - beat > BEAT_TIMEOUT_MS) {
			quitSelf();
		}
	}, 700);
}

/* 退出兜底（多重保险，按优先级）：
   1) 桌面端：本窗口是游戏窗口的子窗口，正常关闭游戏时会自动结束；
   2) 桌面端：每秒检查一次系统里是否还有别的窗口（游戏窗口已关闭）就销毁自己；
   3) 任一模式：超时收不到游戏页面心跳就退出。 */
(function watchdog() {
	if (!electronAvailable) {
		// 安卓：走 localStorage 通道
		startChannelDriver();
		return;
	}
	setInterval(() => {
		if (selfWindow && remote) {
			try {
				const others = remote.BrowserWindow.getAllWindows().filter(item => item.id !== selfWindow.id);
				if (!others.length) {
					quitSelf();
					return;
				}
			} catch (e) {}
		}
		if (Date.now() - lastBeat > HEARTBEAT_TIMEOUT) {
			quitSelf();
		}
	}, 1000);
})();
