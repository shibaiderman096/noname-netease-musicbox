/**
 * 音频输出窗口（隐藏窗口里运行）
 *
 * 意义：无名杀的「重新开始 / 重来」会执行 window.location.reload()，
 * 游戏页面里的一切（包括 Audio 元素）都会被销毁；把音频放在这个独立窗口里，
 * 页面重载期间音乐不会中断，重载后游戏页面再重新接管控制。
 *
 * 本文件只负责「播放一个给定的 URL」，歌单、下一首等逻辑仍然在游戏页面里。
 */
const audio = document.getElementById("audio");
let lastError = 0;
/** 游戏页面每次调用（轮询状态也算）都会刷新心跳，用于兜底退出 */
let lastBeat = Date.now();
const HEARTBEAT_TIMEOUT = 45000;

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

/** 每个方法都会刷新心跳（见下方 watchdog 的第 3 条兜底） */

window.NMBSink = {
	ping() {
		lastBeat = Date.now();
		return "pong";
	},
	beat() {
		lastBeat = Date.now();
		return Date.now();
	},
	/** 载入并播放 */
	load(url, autoplay = true) {
		lastBeat = Date.now();
		lastError = 0;
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
		return {
			hasSrc: !!(audio.currentSrc || audio.getAttribute("src")),
			paused: !!audio.paused,
			ended: !!audio.ended,
			currentTime: audio.currentTime || 0,
			duration: isFinite(audio.duration) ? audio.duration : 0,
			volume: audio.volume,
			error: lastError,
			readyState: audio.readyState,
		};
	},
};

/* 退出兜底（多重保险，按优先级）：
   1) 本窗口是游戏窗口的子窗口，正常关闭游戏时会自动结束；
   2) 本窗口启用了 @electron/remote，每秒检查一次：系统里已经没有别的窗口（游戏窗口已关闭）
      就立刻销毁自己 —— 这是最可靠也最快的一条；
   3) 万一 remote 不可用，则用「45 秒收不到游戏页面心跳」兜底（轮询状态也算心跳）。 */
(function watchdog() {
	let remote = null;
	try {
		remote = require("@electron/remote");
	} catch (e) {
		remote = null;
	}
	let self = null;
	if (remote && remote.BrowserWindow) {
		try {
			self = remote.getCurrentWindow();
		} catch (e) {
			self = null;
		}
	}

	const quitSelf = () => {
		try {
			if (self && !self.isDestroyed()) {
				self.destroy();
				return;
			}
		} catch (e) {}
		try {
			window.close();
		} catch (e) {}
	};

	setInterval(() => {
		if (self && remote) {
			try {
				const others = remote.BrowserWindow.getAllWindows().filter(win => win.id !== self.id);
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
